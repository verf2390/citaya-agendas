import assert from "node:assert/strict";
import { createHash, createPublicKey, createSign, generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  assertCertificationSimulationDrafts,
  buildCertificationSimulationDrafts,
  CERTIFICATION_SIMULATION_FOLIOS_PLAN,
  CERTIFICATION_SIMULATION_PLAN,
  selectUniqueSimulationCaf,
} from "../certification/certification-simulation-model";
import { resolveCertificationSimulationFolioPlan } from "../certification/certification-simulation-set";
import { runControlledCertificationSet } from "../certification/factura-set-dry-run";
import { FolioSqliteLedger } from "../certification/folio-sqlite-ledger";
import { preflightCertificationSetSubmit, submitPreparedCertificationSet } from "../certification/factura-certification-set-submit";

const ISSUER = "76086428-5";
function hash(value: Buffer | string): string { return createHash("sha256").update(value).digest("hex"); }
function write600(path: string, value: Buffer | string): void { writeFileSync(path, value, { mode: 0o600 }); chmodSync(path, 0o600); }
function publicParts(publicKey: string): { modulus: string; exponent: string } {
  const jwk = createPublicKey(publicKey).export({ format: "jwk" }) as { n?: string; e?: string };
  return { modulus: Buffer.from(jwk.n ?? "", "base64url").toString("base64"), exponent: Buffer.from(jwk.e ?? "", "base64url").toString("base64") };
}
function caf(typeCode: 33 | 56 | 61, rangeFrom: number, rangeTo: number) {
  const keys = generateKeyPairSync("rsa", { modulusLength: 1024, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const parts = publicParts(keys.publicKey);
  const da = "<DA><RE>" + ISSUER + "</RE><RS>EMISOR SIMULACION FIXTURE</RS><TD>" + typeCode + "</TD><RNG><D>" + rangeFrom + "</D><H>" + rangeTo + "</H></RNG><FA>2026-07-20</FA><RSAPK><M>" + parts.modulus + "</M><E>" + parts.exponent + "</E></RSAPK><IDK>100</IDK></DA>";
  const signer = createSign("RSA-SHA1"); signer.update(Buffer.from(da, "latin1"));
  const cafXml = "<CAF version=\"1.0\">" + da + "<FRMA algoritmo=\"SHA1withRSA\">" + signer.sign(keys.privateKey, "base64") + "</FRMA></CAF>";
  return { typeCode, rangeFrom, rangeTo, cafXml, privateKeyPem: keys.privateKey, publicKeyPem: keys.publicKey, sha256: hash(cafXml) };
}
function identity() {
  const issuer = { tenantId: "simulation-fixture", rut: ISSUER, legalName: "EMISOR SIMULACION FIXTURE", businessActivity: "SERVICIOS DIGITALES", businessActivityCode: "620200", address: "DIRECCION FIXTURE 100", commune: "SANTIAGO", city: "SANTIAGO", siiResolutionDate: "2026-05-23", siiResolutionNumber: "0", dteEnvironment: "certification" as const };
  const recipients = [
    { rut: "60803000-K", legalName: "RECEPTOR PUBLICO FIXTURE", businessActivity: "SERVICIOS", address: "CALLE FIXTURE 1", commune: "SANTIAGO", city: "SANTIAGO" },
    { rut: "11111111-1", legalName: "RECEPTOR PRIVADO FIXTURE", businessActivity: "TECNOLOGIA", address: "CALLE FIXTURE 2", commune: "PROVIDENCIA", city: "SANTIAGO" },
  ];
  return { issuer, recipients, rutEnvia: ISSUER, issueDate: "2026-07-23" };
}
function seedLedger(path: string): void {
  const ledger = new FolioSqliteLedger(path);
  try {
    const imports = [
      [33,1,5,"a".repeat(64)],[33,6,8,"b".repeat(64)],[61,1,4,"c".repeat(64)],[61,5,6,"d".repeat(64)],[56,1,2,"e".repeat(64)],
      [33,9,16,"14fa4c2d4d8b0de48edfe16f0b375145747e269b7bf0593100b80f1aa058d768"],
      [56,3,4,"cd5b33fd5604ac91762aa5275f369b3abab000a99a3c96601b5b7418b900d40e"],
      [61,7,12,"2cc76903dc3d1bec413b14e9c6f97182b6bf817149aa94cc7d2a02b388ac47c6"],
    ] as const;
    const addImport = ledger.db.prepare("INSERT INTO caf_imports(issuer,type_code,range_from,range_to,content_sha256,logical_identity,imported_at) VALUES(?,?,?,?,?,?,?)");
    const addFolio = ledger.db.prepare("INSERT INTO folios(issuer,type_code,folio,caf_id,state,reserved_case,issued_at) VALUES(?,?,?,?,?,?,?)");
    for (const [type, from, to, sha] of imports) {
      const imported = addImport.run(ISSUER, type, from, to, sha, "logical-" + type + "-" + from, "2026-07-23T12:00:00Z");
      for (let folio = from; folio <= to; folio += 1) {
        const simulation = (type === 33 && folio <= 16) || (type === 56 && folio === 3) || (type === 61 && folio === 7);
        const old = from < 9 && ((type === 33 && folio <= 8) || (type === 56 && folio <= 2) || (type === 61 && folio <= 6));
        const issued = old || simulation;
        let reservedCase: string | null = null;
        if (simulation && !old) {
          const item = CERTIFICATION_SIMULATION_PLAN.find((candidate) => candidate.typeCode === type && candidate.folio === folio) ?? assert.fail("plan");
          reservedCase = "CERTIFICATION-SIMULATION-001:" + item.caseId;
        } else if (old) reservedCase = (folio <= (type === 33 ? 4 : type === 61 ? 3 : 1) ? "SET-4959698-ATTEMPT-001:" : "SET-4959698-REISSUE-001:") + type + "-" + folio;
        addFolio.run(ISSUER, type, folio, Number(imported.lastInsertRowid), issued ? "issued" : "available", reservedCase, issued ? "2026-07-23T12:00:00Z" : null);
      }
    }
  } finally { ledger.close(); }
  chmodSync(path, 0o600);
}
type Fixture = ReturnType<typeof makeFixture>;
let cached: Fixture | undefined;
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "citaya-simulation-"));
  chmodSync(root, 0o700);
  const output = join(root, "output"); mkdirSync(output, { mode: 0o700 }); chmodSync(output, 0o700);
  const cert = join(root, "cert.pem"), key = join(root, "key.pem");
  execFileSync("openssl", ["req","-x509","-newkey","rsa:2048","-keyout",key,"-out",cert,"-nodes","-days","2","-subj","/CN=Simulation Fixture/serialNumber=76086428-5/C=CL"], { stdio: "ignore" });
  chmodSync(cert,0o600); chmodSync(key,0o600);
  const cafs = [caf(33,9,16),caf(56,3,4),caf(61,7,12)];
  const drafts = buildCertificationSimulationDrafts(identity());
  const metadata = {
    schemaVersion: 1, artifactKind: "certification_simulation_set", simulationNumber: 1, documentsCount: 10,
    foliosPlan: CERTIFICATION_SIMULATION_FOLIOS_PLAN, folios: { "33": [9,10,11,12,13,14,15,16], "56": [3], "61": [7] }, contingencyAvailable: "56:4,61:8-12",
    lineage: { artifactKind: "certification_set_reissue", envelopeSha256: "875e311358155109761133688bdbbec1341a038cb0ebdd17290b3e711d4912a0", manifestSha256: "f".repeat(64), registrySha256: "e".repeat(64), trackIdFingerprint: "b617c78b09421d96", portalStage: "SIMULACION" },
    previousArtifactsUnchanged: true, previousRegistriesUnchanged: true, previousLedgerEntriesUnchanged: true,
    officialFrmtValid: "10/10", xsiPhysicallyDeclaredOnDte: "10/10", literalStandaloneXmlsecValid: "10/10", embeddedXmlsecValid: "10/10", outerXmlsecValid: true,
    dteXsd: "10/10", envioDteXsd: "valid", references: "valid", totals: "valid", bom: "absent",
  };
  const result = runControlledCertificationSet({ env: { NODE_ENV: "test", DTE_MODE: "certification", DTE_SII_ENV: "certification", DTE_SII_LIVE_AUTH: "false", DTE_SII_ENABLE_SUBMIT: "false", DTE_SII_ENABLE_STATUS: "false" }, outputDir: output, signingMaterial: { privateKeyPath: key, certificatePath: cert }, drafts, caseIds: CERTIFICATION_SIMULATION_PLAN.map((item) => item.caseId), rutEnvia: ISSUER, importedCafs: cafs, setDteId: "CitayaSetDTE-SIMULATION-001-CERT", envelopeFileName: "EnvioDTE-SIMULATION-001-CERTIFICATION.xml", manifestFileName: "manifest-SIMULATION-001-CERTIFICATION.json", generationTimestamp: "2026-07-23T12:00:00", manifestMetadata: metadata });
  const preparedManifest = JSON.parse(readFileSync(result.manifestPath, "utf8")); preparedManifest.envelopeSha256 = result.envelopeSha256; write600(result.manifestPath, JSON.stringify(preparedManifest, null, 2));
  const ledger = join(root, "ledger.sqlite"); seedLedger(ledger);
  const registry = join(root, "registry"); mkdirSync(registry, { mode: 0o700 }); chmodSync(registry,0o700);
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", DTE_MODE: "certification", DTE_SII_ENV: "certification", DTE_SII_LIVE_AUTH: "true", DTE_SII_ENABLE_SUBMIT: "true", DTE_SII_ENABLE_STATUS: "false", DTE_SII_SUBMIT_URL: "https://maullin.sii.cl/cgi_dte/UPL/DTEUpload", DTE_FACTURA_CERTIFICATION_ENVELOPE_PATH: result.envelopePath, DTE_FACTURA_CERTIFICATION_ENVELOPE_SHA256: result.envelopeSha256, DTE_FACTURA_CERTIFICATION_MANIFEST_PATH: result.manifestPath, DTE_FACTURA_CERTIFICATION_LEDGER_PATH: ledger, DTE_FACTURA_CERTIFICATION_SUBMIT_REGISTRY_DIR: registry, DTE_FACTURA_CERTIFICATION_SUBMIT_CONFIRM: "SUBMIT_SIMULATION_001_" + result.envelopeSha256, DTE_CERT_PATH: cert, DTE_PRIVATE_KEY_PATH: key, SII_RUT_EMPRESA: ISSUER, SII_RUT_USUARIO: ISSUER };
  return { root, output, cert, key, cafs, drafts, result, ledger, registry, env };
}
function fixture(): Fixture { return cached ??= makeFixture(); }

test("simulation plan, CAF selection, references, IVA and contingencies are exact", () => {
  const f = fixture();
  assert.equal(f.result.documents,10); assert.equal(f.result.cafCoverageUnique,"10/10");
  assert.doesNotThrow(() => assertCertificationSimulationDrafts(f.drafts));
  for (const item of CERTIFICATION_SIMULATION_PLAN) assert.equal(selectUniqueSimulationCaf(f.cafs,item.typeCode,item.folio).typeCode,item.typeCode);
  assert.throws(() => selectUniqueSimulationCaf(f.cafs,33,17),/cafCoverageUnique/);
  assert.throws(() => selectUniqueSimulationCaf([...f.cafs,f.cafs[0]],33,9),/cafCoverageUnique/);
  const db = new Database(f.ledger,{readonly:true});
  try { for (const [type,folio] of [[56,4],[61,8],[61,9],[61,10],[61,11],[61,12]]) assert.equal((db.prepare("SELECT state FROM folios WHERE type_code=? AND folio=?").get(type,folio) as {state:string}).state,"available"); } finally { db.close(); }
});

test("simulation artifacts pass FRMT, physical XSI, literal/embedded/outer xmlsec and manifest gates", () => {
  const f=fixture(); const manifest=JSON.parse(readFileSync(f.result.manifestPath,"utf8"));
  assert.equal(manifest.artifactKind,"certification_simulation_set"); assert.equal(manifest.files.length,11); assert.equal(manifest.cafAssignments.length,10);
  assert.equal(f.result.tedFrmt,"10/10"); assert.equal(f.result.dteSignatures,"10/10"); assert.equal(f.result.envelopeSignature,"valid"); assert.equal(f.result.dteXsd,"10/10");
  for(const item of CERTIFICATION_SIMULATION_PLAN){const path=join(f.output,item.caseId+"-DTE-CERTIFICATION.xml");const xml=readFileSync(path,"latin1");assert.match(xml,/<DTE\b[^>]*xmlns:xsi=/);assert.equal(execFileSync("xmlsec1",["--verify","--id-attr:ID","Documento","--pubkey-cert-pem",f.cert,path],{stdio:"ignore"}),null as never);}
});

test("simulation preflight is offline, mock submit accepts STATUS=0 and a second submit is blocked", async () => {
  const f=fixture(); const pre=preflightCertificationSetSubmit(f.env,process.cwd(),{expectedSha256:f.result.envelopeSha256,xsd:()=>true});
  assert.equal(pre.artifactKind,"certification_simulation_set"); assert.equal(pre.xmlsecIndividualValid,"10/10");
  let calls=0; const fetchImpl:typeof fetch=async()=>{calls+=1;if(calls===1)return new Response("<RESPUESTA><RESP_HDR><ESTADO>00</ESTADO></RESP_HDR><RESP_BODY><SEMILLA>12345</SEMILLA></RESP_BODY></RESPUESTA>",{status:200});if(calls===2)return new Response("<RESPUESTA><RESP_HDR><ESTADO>00</ESTADO></RESP_HDR><RESP_BODY><TOKEN>fixture-token</TOKEN></RESP_BODY></RESPUESTA>",{status:200});return new Response("<RECEPCIONDTE><STATUS>0</STATUS><TRACKID>123456789</TRACKID></RECEPCIONDTE>",{status:200});};
  const result=await submitPreparedCertificationSet(f.env,{expectedSha256:f.result.envelopeSha256,xsd:()=>true,fetchImpl});
  assert.equal(calls,3); assert.equal(result.status,"SUBMITTED"); assert.equal(result.statusQueried,false);
  const record=JSON.parse(readFileSync(join(f.registry,f.result.envelopeSha256+".json"),"utf8")); assert.equal(record.trackId,"123456789");
  await assert.rejects(()=>submitPreparedCertificationSet(f.env,{expectedSha256:f.result.envelopeSha256,xsd:()=>true,fetchImpl})); assert.equal(calls,3);
});

test("simulation reservation reuse is append-only and exact", () => {
  const root=mkdtempSync(join(tmpdir(),"simulation-ledger-"));const path=join(root,"ledger.sqlite");const ledger=new FolioSqliteLedger(path);
  try { for(const spec of [{typeCode:33 as const,from:9,to:16},{typeCode:56 as const,from:3,to:4},{typeCode:61 as const,from:7,to:12}]) ledger.importCaf({issuerRut:ISSUER,typeCode:spec.typeCode,rangeFrom:spec.from,rangeTo:spec.to,sha256:hash(spec.typeCode+":"+spec.from),logicalIdentity:"fixture-"+spec.typeCode,sourcePath:"fixture",originalBytes:Buffer.alloc(0),originalXml:"",cafXml:"",cafBytes:Buffer.alloc(0),daXml:"",daBytes:Buffer.alloc(0),issuerName:"fixture",authorizationDate:"2026-07-20",idk:"100",privateKeyPem:"",publicKeyPem:"",materialKind:"fixture",trustStatus:"verified_fixture",fixtureKey:true,weakLegacyFixture:true,realUseBlocked:true}); const first=resolveCertificationSimulationFolioPlan(ledger,ISSUER); const state=()=>ledger.db.prepare("SELECT COUNT(*) total,SUM(state='reserved') reserved FROM folios").get(); const before=state(); const second=resolveCertificationSimulationFolioPlan(ledger,ISSUER); assert.equal(first.reused,false);assert.equal(second.reused,true);assert.deepEqual(second.folios,first.folios);assert.deepEqual(state(),before); } finally {ledger.close();}
});
