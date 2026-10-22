// Zero-cost, self-contained editorial scenes. No external images, fonts or model API.
const THEMES=[
  ["security",/\b(security|secure|privacy|secret|oauth|ruleset|protect|cyber|scanning|disk access|safety|vulnerability)\b/i],
  ["space",/\b(satellite|space|orbit|aerospace)\b/i],
  ["training",/\b(academy|training|education|learning|engineer training)\b/i],
  ["research",/\b(research|math|muse|papers?|science|scientific|study)\b/i],
  ["finance",/\b(investment|returns?|growth|economy|economic|trillion|business)\b/i],
  ["cloud",/\b(cloud|infrastructure|data center|ai factory|regional compute|sovereign)\b/i],
  ["hardware",/\b(gpu|chip|hardware|dgx|rubin|semiconductor|compute|accelerator)\b/i],
  ["device",/\b(desktop|device|gadget|mobile|phone|laptop|computer use)\b/i],
  ["software",/\b(code|coding|copilot|github|api|developer|model|builder|agent|cli|software)\b/i]
];
export function classifyCoverTheme(title,slug=""){
  const input=String(title||"")+" "+String(slug||"").replace(/[-_]/g," ");
  return THEMES.find(([,pattern])=>pattern.test(input))?.[0]||"network";
}
const COLORS={
  security:["#68e4c8","#1e867f"],
  space:["#a2c3ff","#4256a0"],
  training:["#8eecc0","#248c83"],
  research:["#d9a7ff","#7450af"],
  finance:["#ffda91","#aa7a2c"],
  cloud:["#75ddff","#3580ac"],
  hardware:["#ffc589","#a46b3b"],
  device:["#8ac3ff","#3b76b8"],
  software:["#c0adff","#6656a2"],
  network:["#91e4f6","#367da8"]
};
const SCENES={
  security:'<path d="M210 12L345 64V220Q345 310 210 377Q75 310 75 220V64Z" fill="#112f4e" stroke="currentColor" stroke-width="8"/><path d="M210 42L312 83V215Q312 286 210 343Q108 286 108 215V83Z" fill="none" stroke="currentColor" stroke-width="2" opacity=".6"/><rect x="159" y="166" width="102" height="105" rx="14" fill="currentColor" opacity=".95"/><path d="M179 165V134a31 31 0 0162 0v31" fill="none" stroke="currentColor" stroke-width="14"/><circle cx="210" cy="215" r="11" fill="#0c2340"/><path d="M210 225v19" stroke="#0c2340" stroke-width="10"/><path d="M66 160H18M354 160h44M73 280H24M350 280h48" fill="none" stroke="currentColor" stroke-width="6" opacity=".7"/>',
  space:'<path d="M-40 390Q210 210 470 395" fill="none" stroke="currentColor" stroke-width="25" opacity=".5"/><circle cx="212" cy="180" r="56" fill="currentColor" opacity=".92"/><path d="M170 150h85v65h-85z" fill="#13314d" stroke="currentColor" stroke-width="6"/><path d="M65 118h96v96H65zm198 0h96v96h-96z" fill="#2d6396" stroke="currentColor" stroke-width="7"/><path d="M65 149h96M65 180h96M98 118v96M130 118v96M263 149h96M263 180h96M295 118v96M326 118v96" stroke="currentColor" stroke-width="3" opacity=".75"/><path d="M212 127v-70l25-14" stroke="currentColor" stroke-width="7" fill="none"/><circle cx="238" cy="42" r="13" fill="currentColor"/><path d="M30 68q180-125 365 85" stroke="currentColor" fill="none" stroke-dasharray="10 15" opacity=".5" stroke-width="3"/>',
  training:'<path d="M42 250V84Q131 37 212 94Q291 37 382 84v166q-95-42-170 7Q136 208 42 250Z" fill="#e8f7ed" stroke="currentColor" stroke-width="8"/><path d="M212 94v162M80 127q70-30 108-3M80 163q70-30 108-3M236 125q58-22 106 0M236 162q58-22 106 0" fill="none" stroke="#248c83" stroke-width="5"/><path d="M150 320h124M212 252v63" stroke="currentColor" stroke-width="10"/><path d="M207 14l9 28m-76 2l22 16m103-16l-22 16" stroke="currentColor" stroke-width="7" opacity=".6"/>',
  research:'<rect x="70" y="82" width="174" height="230" rx="8" fill="#eaf0fb" stroke="currentColor" stroke-width="6" transform="rotate(-12 157 197)"/><rect x="164" y="68" width="184" height="245" rx="8" fill="#f7f5ff" stroke="currentColor" stroke-width="7" transform="rotate(8 256 190)"/><path d="M205 135h100M205 167h100M205 202h73" stroke="#7656a5" stroke-width="8" opacity=".6"/><g fill="currentColor"><circle cx="65" cy="68" r="11"/><circle cx="355" cy="52" r="11"/><circle cx="373" cy="355" r="11"/><circle cx="76" cy="339" r="11"/></g><path d="M65 68L355 52L373 355L76 339Z" fill="none" stroke="currentColor" stroke-width="3" opacity=".4"/>',
  finance:'<path d="M54 337H392" stroke="currentColor" stroke-width="8"/><rect x="72" y="236" width="52" height="100" rx="7" fill="currentColor" opacity=".4"/><rect x="150" y="182" width="52" height="154" rx="7" fill="currentColor" opacity=".55"/><rect x="228" y="135" width="52" height="201" rx="7" fill="currentColor" opacity=".75"/><rect x="306" y="63" width="52" height="273" rx="7" fill="currentColor"/><path d="M61 217L165 145L243 105L366 28M323 32l43-4-5 43" stroke="currentColor" stroke-width="10" fill="none"/>',
  cloud:'<path d="M103 167q-27-95 69-111q61-76 135-6q101-3 98 108q-3 64-92 64H121q-91-1-75-72q4-34 57-40" fill="currentColor" opacity=".86"/><rect x="116" y="235" width="85" height="142" rx="10" fill="#123653" stroke="currentColor" stroke-width="7"/><rect x="228" y="235" width="85" height="142" rx="10" fill="#123653" stroke="currentColor" stroke-width="7"/><path d="M133 265h50m-50 35h50m-50 35h50m62-70h50m-50 35h50m-50 35h50" stroke="currentColor" stroke-width="7"/><path d="M159 221v14m112-14v14" stroke="currentColor" stroke-width="6"/><circle cx="159" cy="358" r="5" fill="currentColor"/><circle cx="271" cy="358" r="5" fill="currentColor"/>',
  hardware:'<rect x="108" y="70" width="222" height="256" rx="20" fill="#102c47" stroke="currentColor" stroke-width="9"/><rect x="151" y="109" width="135" height="170" rx="10" fill="currentColor" opacity=".55"/><rect x="170" y="130" width="96" height="128" rx="6" fill="#173955" stroke="currentColor" stroke-width="5"/><path d="M108 115H54m54 50H54m54 50H54m54 50H54m276-150h52m-52 50h52m-52 50h52m-52 50h52M153 70V28m52 42V28m52 42V28M153 326v42m52-42v42m52-42v42" stroke="currentColor" stroke-width="9"/><path d="M187 176h58v40h-58z" fill="currentColor"/>',
  device:'<rect x="54" y="92" width="288" height="200" rx="16" fill="#0d2745" stroke="currentColor" stroke-width="9"/><path d="M43 310h320l25 37H18z" fill="currentColor"/><rect x="77" y="113" width="241" height="155" rx="6" fill="#23537e"/><path d="M111 163h130m-130 31h169m-169 31h112" stroke="currentColor" stroke-width="8"/><rect x="295" y="124" width="105" height="209" rx="19" fill="#102b49" stroke="currentColor" stroke-width="7"/><rect x="309" y="148" width="77" height="145" rx="5" fill="#23537e"/><circle cx="348" cy="314" r="7" fill="currentColor"/>',
  software:'<rect x="37" y="48" width="361" height="292" rx="18" fill="#102c4b" stroke="currentColor" stroke-width="7"/><path d="M38 102h357" stroke="currentColor" stroke-width="6"/><circle cx="69" cy="75" r="7" fill="currentColor"/><circle cx="94" cy="75" r="7" fill="currentColor" opacity=".55"/><circle cx="119" cy="75" r="7" fill="currentColor" opacity=".3"/><path d="M139 157l-59 49 59 49M295 157l59 49-59 49M246 137l-62 141" fill="none" stroke="currentColor" stroke-width="15" stroke-linejoin="round"/><path d="M65 306h134" stroke="currentColor" stroke-width="6" opacity=".4"/>',
  network:'<path d="M59 108l168-67 156 120-75 165-209-20zM59 108l249 218M227 41l-128 265M383 161L59 108" fill="none" stroke="currentColor" stroke-width="6" opacity=".68"/><g fill="currentColor"><circle cx="59" cy="108" r="26"/><circle cx="227" cy="41" r="24"/><circle cx="383" cy="161" r="28"/><circle cx="308" cy="326" r="29"/><circle cx="99" cy="306" r="25"/></g>'
};
function escapeXml(value){
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu,"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function titleLines(value){
  const safe=Array.from(String(value||"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu,"")).slice(0,70).join("");
  const words=safe.trim().split(/\s+/);
  const lines=[];let current="";
  for(const word of words){
    if(!word)continue;
    if(current&&Array.from(current+" "+word).length>29){lines.push(current);current=word;}
    else current=current?current+" "+word:word;
  }
  if(current)lines.push(current);
  return lines.slice(0,3);
}
export function editorialCoverSvg(title,slug=""){
  const theme=classifyCoverTheme(title,slug);
  const [bright,secondary]=COLORS[theme];
  const headline=titleLines(title);
  const headlineXml=headline.map((line,i)=>
    '<text x="72" y="'+(318+i*67)+'" font-size="48" font-weight="700" fill="#f7fbff">'+escapeXml(line)+'</text>').join("");
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-labelledby="title desc">',
    '<title id="title">'+escapeXml(title)+'</title>',
    '<desc id="desc">Original TigerIQ conceptual editorial scene: '+escapeXml(theme)+'. No third-party logos or documentary photography.</desc>',
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#08172e"/><stop offset="1" stop-color="'+secondary+'"/></linearGradient>',
    '<pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#b7dcff" stroke-width="1" opacity=".13"/></pattern></defs>',
    '<rect width="1200" height="675" fill="url(#bg)"/><rect width="1200" height="675" fill="url(#grid)"/>',
    '<path d="M655 0L1200 55V675L620 675Z" fill="'+secondary+'" opacity=".27"/>',
    '<rect x="655" y="65" width="500" height="505" rx="34" fill="#07182f" opacity=".37" stroke="'+bright+'" stroke-opacity=".42" stroke-width="2"/>',
    '<g data-scene="'+theme+'" transform="translate(697 120)" color="'+bright+'">'+SCENES[theme]+'</g>',
    '<g font-family="Arial,Helvetica,sans-serif">',
    '<text x="72" y="99" font-size="25" font-weight="700" letter-spacing="4" fill="'+bright+'">TIGERIQ GLOBAL AI NEWS</text>',
    '<rect x="72" y="133" width="75" height="6" rx="3" fill="'+bright+'"/>',
    '<text x="72" y="231" font-size="28" letter-spacing="4" fill="'+bright+'">'+theme.toUpperCase()+' / EDITORIAL</text>',
    headlineXml,
    '<text x="72" y="614" font-size="19" fill="#d0e8f6">Original editorial illustration · No external imagery</text>',
    '</g></svg>\n'
  ].join("");
}
