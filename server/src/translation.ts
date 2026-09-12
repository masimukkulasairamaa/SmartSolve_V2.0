import { config } from "./config.js";
import { pool } from "./db/pool.js";

type Translation = { sourceLanguage:string; targetLanguage:string; originalTitle:string; originalDescription:string; translatedTitle:string; translatedDescription:string; provider:string; model:string|null };

export async function translateChallenge(challengeId:string,targetLanguage:string):Promise<Translation> {
  const c = await pool.query(`SELECT c.title,c.description,c.preferred_language FROM challenges c WHERE c.id=$1`,[challengeId]);
  if(!c.rowCount) throw new Error("Challenge not found");
  const source = c.rows[0].preferred_language || "en";
  const existing = await pool.query(`SELECT source_language,target_language,original_title,original_description,translated_title,translated_description,provider,model FROM challenge_translations WHERE challenge_id=$1 AND target_language=$2`,[challengeId,targetLanguage]);
  if(existing.rowCount && existing.rows[0].original_title===c.rows[0].title && existing.rows[0].original_description===c.rows[0].description) return existing.rows[0];
  if(source.toLowerCase()===targetLanguage.toLowerCase()) {
    const d={sourceLanguage:source,targetLanguage,originalTitle:c.rows[0].title,originalDescription:c.rows[0].description,translatedTitle:c.rows[0].title,translatedDescription:c.rows[0].description,provider:"identity",model:null};
    await saveTranslation(challengeId,d); return d;
  }
  if(!config.translationApiKey || !config.translationBaseUrl || !config.translationModel) throw new Error("Translation provider is not configured for this target language.");
  const response = await fetch(`${config.translationBaseUrl.replace(/\/$/,"")}/chat/completions`, { method:"POST", headers:{"Content-Type":"application/json",Authorization:`Bearer ${config.translationApiKey}`}, body:JSON.stringify({model:config.translationModel,temperature:0,response_format:{type:"json_object"},messages:[{role:"system",content:"You are a translation service. Translate only the supplied title and description. Preserve meaning, names, places, quantities and formatting. Return JSON with translatedTitle and translatedDescription. Do not add commentary."},{role:"user",content:JSON.stringify({sourceLanguage:source,targetLanguage,title:c.rows[0].title,description:c.rows[0].description})}]}) });
  if(!response.ok) throw new Error(`Translation provider returned HTTP ${response.status}`);
  const payload:any=await response.json(); const raw=payload?.choices?.[0]?.message?.content; if(typeof raw!=="string") throw new Error("Translation provider returned no content");
  let parsed:any; try{parsed=JSON.parse(raw)}catch{throw new Error("Translation provider returned invalid JSON")}
  if(typeof parsed.translatedTitle!=="string"||typeof parsed.translatedDescription!=="string") throw new Error("Translation provider returned incomplete translation");
  const d={sourceLanguage:source,targetLanguage,originalTitle:c.rows[0].title,originalDescription:c.rows[0].description,translatedTitle:parsed.translatedTitle,translatedDescription:parsed.translatedDescription,provider:"external",model:config.translationModel}; await saveTranslation(challengeId,d); return d;
}

async function saveTranslation(challengeId:string,d:Translation){await pool.query(`INSERT INTO challenge_translations(challenge_id,source_language,target_language,original_title,original_description,translated_title,translated_description,provider,model) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(challenge_id,target_language) DO UPDATE SET source_language=EXCLUDED.source_language,original_title=EXCLUDED.original_title,original_description=EXCLUDED.original_description,translated_title=EXCLUDED.translated_title,translated_description=EXCLUDED.translated_description,provider=EXCLUDED.provider,model=EXCLUDED.model,updated_at=NOW()`,[challengeId,d.sourceLanguage,d.targetLanguage,d.originalTitle,d.originalDescription,d.translatedTitle,d.translatedDescription,d.provider,d.model]);}
export async function getTranslations(challengeId:string){const r=await pool.query(`SELECT * FROM challenge_translations WHERE challenge_id=$1 ORDER BY created_at DESC`,[challengeId]);return r.rows;}
