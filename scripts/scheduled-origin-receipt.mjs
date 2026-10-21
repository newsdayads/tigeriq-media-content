// GitHub-side correlation aid, not proof that a Cloudflare Scheduled Trigger ran.
// Log only allowlisted values. Never print raw workflow inputs or credentials.
const CANONICAL_HOUR=/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):00:00Z$/;

function canonicalHour(value){
  if(typeof value!=="string"||!CANONICAL_HOUR.test(value))return null;
  const millis=Date.parse(value);
  return Number.isFinite(millis)&&new Date(millis).toISOString()===value.replace("Z",".000Z")
    ?value:null;
}

function numericId(value){
  return typeof value==="string"&&/^\d{1,18}$/.test(value)?value:null;
}

export function scheduledOriginReceipt(env={}){
  const event=env.GITHUB_EVENT_NAME==="schedule"?"schedule":
    env.GITHUB_EVENT_NAME==="workflow_dispatch"?"workflow_dispatch":"other";
  const origin=event==="schedule"?"github_native_schedule":
    event==="workflow_dispatch"&&env.NEWS_SCHEDULER_ORIGIN==="cloudflare"
      ?"cloudflare_input_unverified":"manual_or_other";
  return {
    event,
    origin,
    scheduledHourUtc:event==="workflow_dispatch"?canonicalHour(env.NEWS_SCHEDULED_HOUR_UTC):null,
    githubRunId:numericId(env.GITHUB_RUN_ID),
    githubRunAttempt:numericId(env.GITHUB_RUN_ATTEMPT),
    cloudflareNativeEvent:"NOT_VERIFIED_BY_GITHUB_INPUT"
  };
}

if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith("/"+process.argv[1].split(/[\\/]/).at(-1))){
  console.log("TIGERIQ_SCHEDULED_ORIGIN_RECEIPT "+JSON.stringify(scheduledOriginReceipt(process.env)));
}
