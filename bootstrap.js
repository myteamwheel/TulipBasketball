const fs=require("fs"),path=require("path"),zlib=require("zlib");
const chunks=fs.readdirSync(__dirname).filter(n=>/^payload\.\d+\.txt$/.test(n)).sort();
const encoded=chunks.map(n=>fs.readFileSync(path.join(__dirname,n),"utf8").trim()).join("");
const files=JSON.parse(zlib.brotliDecompressSync(Buffer.from(encoded,"base64")).toString("utf8"));
for(const [rel,data] of Object.entries(files)){const target=path.join(__dirname,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);}
console.log(`Patch 14 bootstrap restored ${Object.keys(files).length} source files from ${chunks.length} chunks.`);
