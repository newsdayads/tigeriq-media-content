// Cron-only Cloudflare Worker. No public HTTP endpoint and no Gemini/API content key.
const URL="https://api.github.com/repos/newsdayads/tigeriq-media-content/actions/workflows/hourly-publisher.yml/dispatches";

export function scheduledHourUtc(time){
  const d=new Date(time);
  if(!Number.isFinite(d.getTime()))throw Error("INVALID_SCHEDULED_TIME");
  return d.toISOString().slice(0,13)+":00:00Z";
}

export async function dispatchNewsHour({env,scheduledTime,fetchImpl=fetch}){
  const token=env?.GITHUB_ACTIONS_TOKEN;
  if(typeof token!=="string"||token.length<20)throw Error("GITHUB_ACTIONS_TOKEN_NOT_CONFIGURED");
  const hour=scheduledHourUtc(scheduledTime);
  const response=await fetchImpl(URL,{
    method:"POST",
    headers:{
      "Accept":"application/vnd.github+json",
      "Authorization":"Bearer "+token,
      "X-GitHub-Api-Version":"2022-11-28",
      "User-Agent":"TigerIQ-News-Cloud-Cron"
    },
    body:JSON.stringify({ref:"main",inputs:{scheduler:"cloudflare",scheduled_hour_utc:hour}})
  });
  // Never log/echo token, response body, or request headers.
  if(response.status!==204)throw Error("GITHUB_WORKFLOW_DISPATCH_HTTP_"+response.status);
  return {hour,accepted:true}; // Accepted queueing is NOT proof of article publication.
}

export default {
  async scheduled(controller,env,ctx){
    ctx.waitUntil(dispatchNewsHour({env,scheduledTime:controller.scheduledTime})
      .then(result=>console.log("CLOUD_CRON_DISPATCH_ACCEPTED hour="+result.hour))
      .catch(error=>{
        // Only fixed error codes may reach logs, never a provider response.
        const code=/^GITHUB_(?:ACTIONS_TOKEN_NOT_CONFIGURED|WORKFLOW_DISPATCH_HTTP_\d{3})$/.test(error.message)
          ?error.message:"CLOUD_CRON_UNCLASSIFIED_FAILURE";
        console.error(code);
        throw Error(code);
      }));
  }
};
