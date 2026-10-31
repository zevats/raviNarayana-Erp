// Builds the signed release APK and publishes it for download.
//   cd mobile && npm run apk
// Needs: JDK 17+ (JAVA_HOME or C:\Program Files\Java\jdk-23), the Android SDK (ANDROID_HOME or
// %LOCALAPPDATA%\Android\Sdk), and the signing keystore properties at ~/.ravinarayan/keystore.properties.
// Output: mobile/dist/ravinarayan-<version>.apk and apps/erp/public/download/ravinarayan.apk
// (served by the ERP at /download/ravinarayan.apk once deployed).
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const android = path.join(root, "android");
const isWin = process.platform === "win32";

const env = { ...process.env };
env.JAVA_HOME = env.JAVA_HOME || (isWin ? "C:\\Program Files\\Java\\jdk-23" : "");
env.ANDROID_HOME = env.ANDROID_HOME || (isWin ? path.join(env.LOCALAPPDATA || "", "Android", "Sdk") : path.join(os.homedir(), "Android", "Sdk"));
if (!fs.existsSync(env.ANDROID_HOME)) throw new Error(`Android SDK not found at ${env.ANDROID_HOME}. Set ANDROID_HOME.`);
const props = env.RN_KEYSTORE_PROPERTIES || path.join(os.homedir(), ".ravinarayan", "keystore.properties");
if (!fs.existsSync(props)) throw new Error(`Signing keystore properties not found at ${props}. See mobile/README.md.`);
fs.writeFileSync(path.join(android, "local.properties"), `sdk.dir=${env.ANDROID_HOME.replace(/\\/g, "/")}\n`);

const run = (cmd, cwd = root) => execSync(cmd, { cwd, env, stdio: "inherit" });
run("node scripts/make-alert-sound.js");
run("npx cap sync android");
run(isWin ? `"${path.join(android, "gradlew.bat")}" assembleRelease --no-daemon` : "./gradlew assembleRelease --no-daemon", android);

const apk = path.join(android, "app", "build", "outputs", "apk", "release", "app-release.apk");
const gradle = fs.readFileSync(path.join(android, "app", "build.gradle"), "utf8");
const version = (gradle.match(/versionName "([^"]+)"/) || [])[1] || "0.0.0";
const code = (gradle.match(/versionCode (\d+)/) || [])[1] || "0";
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
const named = path.join(dist, `ravinarayan-${version}.apk`);
fs.copyFileSync(apk, named);
const pub = path.join(root, "..", "apps", "erp", "public", "download");
fs.mkdirSync(pub, { recursive: true });
fs.copyFileSync(apk, path.join(pub, "ravinarayan.apk"));
const bytes = fs.statSync(apk).size;
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(apk)).digest("hex");
fs.writeFileSync(path.join(pub, "ravinarayan.json"), JSON.stringify({ version, versionCode: Number(code), bytes, sha256, builtAt: new Date().toISOString() }, null, 2));
console.log(`\nRavinarayan ${version} (code ${code}) — ${(bytes / 1048576).toFixed(2)} MB\nSHA-256 ${sha256}\n${named}\n${path.join(pub, "ravinarayan.apk")}`);
