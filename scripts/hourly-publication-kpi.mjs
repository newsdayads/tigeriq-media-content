// Fail a scheduled publish unless exactly one story was committed for its UTC hour.
// Uses local content.json only: no provider, account, or external network calls.
// GitHub workflow_dispatch inputs do NOT attest a native Cloudflare Cron event.
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";

const HOUR=/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):00:00Z$/;
const PUBLISHED_AT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const NATIVE_PROOF="NOT_VERIFIED_BY_GITHUB_INPUT";
const ORIGINAL_COVER_PREFIX="https://raw.githubusercontent.com/newsdayads/tigeriq-media-content/main/covers/";

// A timestamp is not a published product. A counted hourly story must carry
// all three native editions and its own original, canonical SVG cover.
// This local gate cannot attest live HTTP or the Cloudflare trigger.
function hasPublicationArtifacts(article){
  const slug=article?.slug;
  return typeof slug==="string"&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)&&
    ["vi","en","es"].every(lang=>
      typeof article?.editions?.[lang]?.title==="string"&&
      article.editions[lang].title.trim().length>0)&&
    article?.cover?.generated===true&&
    article.cover.url===ORIGINAL_COVER_PREFIX+slug+".svg";
}

function validUtcHour(value){
  if(typeof value!=="string"||!HOUR.test(value))return null;
  const millis=Date.parse(value);
  return Number.isFinite(millis)&&new Date(millis).toISOString()===value.replace("Z",".000Z")
    ?value:null;
}

// GitHub's scheduled Actions can start after the UTC hour boundary (a real
// backup run scheduled for :47 began at 07:35Z). Using execution time's hour
// would falsely accept a 07Z story for the missed 06Z backup. Attribute the
// check to the latest :47 cron tick at/before execution, never future :47.
// This is an inferred attribution, NOT an attested GitHub scheduled timestamp.
const GITHUB_BACKUP_CRON_MINUTE=47;
function expectedGithubBackupHour(now){
  const execution=new Date(now);
  if(!Number.isFinite(execution.getTime()))return null;
  const due=new Date(execution.getTime());
  due.setUTCMinutes(GITHUB_BACKUP_CRON_MINUTE,0,0);
  if(due.getTime()>execution.getTime())due.setUTCHours(due.getUTCHours()-1);
  return validUtcHour(due.toISOString().slice(0,13)+":00:00Z");
}

export function evaluateHourlyPublication({eventName,schedulerOrigin,scheduledHourUtc,now=new Date(),store}={}){
  const enforced=eventName==="schedule"||
    (eventName==="workflow_dispatch"&&schedulerOrigin==="cloudflare");
  if(!enforced)return {enforced:false,passed:null,code:"NOT_SCHEDULED",
    hourUtc:null,cloudflareNativeEvent:NATIVE_PROOF};
  const hourUtc=eventName==="schedule"
    ?expectedGithubBackupHour(now)
    :validUtcHour(scheduledHourUtc);
  if(!hourUtc)return {enforced:true,passed:false,code:"INVALID_SCHEDULE_HOUR",
    hourUtc:null,cloudflareNativeEvent:NATIVE_PROOF};
  // A forged Feb 30 timestamp can normalize to March 2 under Date.parse;
  // an article dated later than this run also cannot already be published.
  // Apply the same strict UTC roundtrip and no-future rule as the publisher.
  const evaluationTime=new Date(now).getTime();
  if(!Number.isFinite(evaluationTime))return {enforced:true,passed:false,
    code:"INVALID_EVALUATION_TIME",hourUtc,cloudflareNativeEvent:NATIVE_PROOF};
  // The product contract is EXACTLY one new article per UTC hour, not merely
  // at least one. A duplicate must fail CI even if one story is legitimate.
  const inHour=Array.isArray(store?.articles)?store.articles.filter(article=>{
    const value=article?.publishedAt;
    if(typeof value!=="string"||!PUBLISHED_AT.test(value))return false;
    const time=Date.parse(value);
    return Number.isFinite(time)&&time<=evaluationTime&&
      new Date(time).toISOString().slice(0,19)===value.slice(0,19)&&
      new Date(time).toISOString().slice(0,13)===hourUtc.slice(0,13);
  }):[];
  const committedStoryCount=inHour.length;
  const artifactComplete=committedStoryCount===1&&hasPublicationArtifacts(inHour[0]);
  const passed=committedStoryCount===1&&artifactComplete;
  const code=committedStoryCount===0?"MISSED_HOURLY_TARGET_NO_COMMITTED_STORY":
    committedStoryCount>1?"MULTIPLE_COMMITTED_STORIES_IN_UTC_HOUR":
      artifactComplete?"COMMITTED_STORY_PRESENT":"INCOMPLETE_TRILINGUAL_OR_COVER_PUBLICATION";
  return {enforced:true,passed,code,committedStoryCount,
    hourUtc,cloudflareNativeEvent:NATIVE_PROOF};
}

export async function runHourlyPublicationKpi({env=process.env,now=new Date(),root="."}={}){
  const eventName=env.GITHUB_EVENT_NAME;
  const scheduled=eventName==="schedule"||
    (eventName==="workflow_dispatch"&&env.NEWS_SCHEDULER_ORIGIN==="cloudflare");
  const store=scheduled?JSON.parse(await readFile(root+"/content.json","utf8")):null;
  const result=evaluateHourlyPublication({eventName,schedulerOrigin:env.NEWS_SCHEDULER_ORIGIN,
    scheduledHourUtc:env.NEWS_SCHEDULED_HOUR_UTC,now,store});
  console.log("TIGERIQ_HOURLY_PUBLICATION_KPI "+JSON.stringify(result));
  if(result.enforced&&!result.passed){
    console.error("::error title=TigerIQ News hourly KPI::"+result.code);
    process.exitCode=1;
  }
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runHourlyPublicationKpi().catch(()=>{
    console.error("::error title=TigerIQ News hourly KPI::KPI_READBACK_FAILED");
    process.exitCode=1;
  });
}
