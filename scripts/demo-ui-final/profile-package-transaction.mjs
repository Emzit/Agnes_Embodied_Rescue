import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const ROOT='/data-ssd/zhongchengkai/agnes';
const require=createRequire(ROOT+'/third_party/agnes-harness/packages/base/package.json');
const {parseDocument,isSeq}=require('yaml');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const scoped=value=>{const p=path.resolve(value);if(!p.startsWith(ROOT+'/'))throw Error('PROFILE_TRANSACTION_PATH_OUTSIDE_PROJECT');return p;};
function atomic(file,content){const temporary=file+'.scene-'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temporary,content,{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}
export function withdrawPackageDeclaration(text,packageId){
 const doc=parseDocument(text);if(doc.errors.length)throw Error('INVALID_PROFILE_YAML');
 const packages=doc.get('packages');if(packages===undefined)return text;
 if(!isSeq(packages))throw Error('INVALID_PROFILE_PACKAGES');
 const indices=packages.items.map((item,index)=>item?.get?.('id')===packageId?index:-1).filter(index=>index>=0);
 if(indices.length>1)throw Error('DUPLICATE_PROFILE_PACKAGE');
 if(!indices.length)return text;
 packages.delete(indices[0]);return String(doc);
}
export function beginPackageProfileTransaction({profilePath,jobDir,packageId}){
 profilePath=scoped(profilePath);jobDir=scoped(jobDir);fs.mkdirSync(jobDir,{recursive:true});
 const manifestFile=path.join(jobDir,'profile-reference-transaction.json');if(fs.existsSync(manifestFile))throw Error('PROFILE_TRANSACTION_ALREADY_EXISTS');
 const before=fs.readFileSync(profilePath),withdrawn=Buffer.from(withdrawPackageDeclaration(before.toString('utf8'),packageId));
 const backup=path.join(jobDir,'profile-before.yaml');fs.writeFileSync(backup,before,{flag:'wx',mode:0o600});
 const manifest={profilePath,packageId,backup,original_sha256:sha(before),withdrawn_sha256:sha(withdrawn),phase:'PREPARED',created_at:new Date().toISOString(),scope:'Temporarily withdraw only this plugin declaration; preserve every other profile field and restore exact original bytes.'};
 atomic(manifestFile,JSON.stringify(manifest,null,2)+'\n');
 if(sha(fs.readFileSync(profilePath))!==manifest.original_sha256)throw Error('PROFILE_CHANGED_BEFORE_WITHDRAWAL');
 if(manifest.original_sha256!==manifest.withdrawn_sha256)atomic(profilePath,withdrawn);
 manifest.phase='WITHDRAWN';atomic(manifestFile,JSON.stringify(manifest,null,2)+'\n');return manifest;
}
export function restorePackageProfileTransaction(jobDir){
 jobDir=scoped(jobDir);const file=path.join(jobDir,'profile-reference-transaction.json');if(!fs.existsSync(file))return {restored:true,needed:false};
 const manifest=JSON.parse(fs.readFileSync(file,'utf8')),profilePath=scoped(manifest.profilePath),backup=scoped(manifest.backup);const original=fs.readFileSync(backup);if(sha(original)!==manifest.original_sha256)throw Error('PROFILE_BACKUP_HASH_MISMATCH');
 const current=sha(fs.readFileSync(profilePath));
 if(current!==manifest.original_sha256&&current!==manifest.withdrawn_sha256)throw Error('PROFILE_CHANGED_DURING_SCENE_TRANSACTION');
 if(current!==manifest.original_sha256)atomic(profilePath,original);
 if(sha(fs.readFileSync(profilePath))!==manifest.original_sha256)throw Error('PROFILE_RESTORE_NOT_EXACT');
 manifest.phase='RESTORED';manifest.restored_at=new Date().toISOString();manifest.restored_sha256=manifest.original_sha256;atomic(file,JSON.stringify(manifest,null,2)+'\n');return {restored:true,sha256:manifest.original_sha256};
}
