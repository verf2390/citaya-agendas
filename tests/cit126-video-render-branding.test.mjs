import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const compose = fs.readFileSync(
  new URL("../video-production/scripts/compose.py", import.meta.url),
  "utf8",
);

test("custom-client-video renders the editable project category in brand chrome", () => {
  assert.match(
    compose,
    /if custom:[\s\S]*?<div class="niche">\{E\(c\["project"\]\["category"\]\)\}<\/div>/,
  );
  assert.doesNotMatch(
    compose,
    /if custom:[\s\S]*?<div class="niche">\{E\(ctx\["niche"\]\["name"\]\)\}<\/div>/,
  );
});
