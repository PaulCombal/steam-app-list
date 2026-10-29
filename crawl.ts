// Builds games.xml (the format of gibbed's https://gib.me/sam/games.xml) by
// asking Steam's product-info service (PICS) about every appid, logged in
// anonymously.
//
//   bun crawl.ts                        full crawl, writes games.xml
//   bun crawl.ts segment <start> <end> <out.json>
//
// Each 500k-appid segment runs in its own process: a single long-lived
// steam-user client aborts after ~1.5M appids.
import SteamUser from "steam-user";

const SEGMENT = 500_000;
const CHUNK = 5_000;
// steam-user can leave a request pending forever (e.g. after a silent
// disconnect), so every request and every segment gets a deadline.
const REQUEST_TIMEOUT_MS = 60_000;
const SEGMENT_TIMEOUT_MS = 15 * 60_000;
const MIN_APPS = Number(process.env.MIN_APPS ?? 80_000);
const OUTPUT = process.env.OUTPUT ?? "games.xml";
const GIBBED_LIST_URL = "https://gib.me/sam/games.xml";
const PUBLISHED_LIST_URL = "https://raw.githubusercontent.com/PaulCombal/steam-app-list/list/games.xml";

// Listed when Steam exposes community stats for the app; the value is the
// XML type attribute.
const LISTED_TYPES: Record<string, string | null> = {
  game: null,
  application: null,
  demo: "demo",
  mod: "mod",
};

type Listed = [id: number, type: string | null];
type SegmentResult = { known: number; listed: Listed[] };

async function crawlSegment(start: number, end: number): Promise<SegmentResult> {
  const client = new SteamUser({ enablePicsCache: false });
  await new Promise<void>((resolve, reject) => {
    client.once("loggedOn", () => resolve());
    client.once("error", reject);
    client.logOn({ anonymous: true });
  });

  const result: SegmentResult = { known: 0, listed: [] };
  for (let first = start; first < end; first += CHUNK) {
    const ids = Array.from({ length: Math.min(CHUNK, end - first) }, (_, i) => first + i);
    let info;
    for (let attempt = 1; ; attempt++) {
      try {
        info = await Promise.race([
          client.getProductInfo(ids, [], false),
          Bun.sleep(REQUEST_TIMEOUT_MS).then(() => {
            throw new Error("request timed out");
          }),
        ]);
        break;
      } catch (e) {
        console.log(`appids ${first}+: ${(e as Error).message} (attempt ${attempt})`);
        if (attempt >= 5) throw e;
        await Bun.sleep(5_000 * attempt);
      }
    }

    for (const [id, app] of Object.entries<any>(info.apps)) {
      result.known++;
      const common = app.appinfo?.common ?? {};
      const type = String(common.type ?? "").toLowerCase();
      if (common.community_visible_stats && type in LISTED_TYPES) {
        result.listed.push([Number(id), LISTED_TYPES[type]]);
      }
    }
  }

  client.logOff();
  return result;
}

async function runSegment(start: number, end: number): Promise<SegmentResult> {
  const out = `segment-${start}.json`;
  for (let attempt = 1; ; attempt++) {
    const child = Bun.spawn([process.execPath, import.meta.path, "segment", `${start}`, `${end}`, out], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const watchdog = setTimeout(() => child.kill(), SEGMENT_TIMEOUT_MS);
    const code = await child.exited;
    clearTimeout(watchdog);
    if (code === 0) {
      const result: SegmentResult = await Bun.file(out).json();
      await Bun.file(out).delete();
      return result;
    }
    console.log(`appids ${start}-${end}: segment exited with ${code} (attempt ${attempt})`);
    if (attempt >= 3) throw new Error(`Segment ${start} failed ${attempt} times`);
    await Bun.sleep(30_000);
  }
}

async function crawlAll() {
  const t0 = Date.now();
  const listed: Listed[] = [];
  for (let start = 0; ; start += SEGMENT) {
    const segment = await runSegment(start, start + SEGMENT);
    console.log(
      `appids ${start}-${start + SEGMENT}: ${segment.known} known, ${segment.listed.length} listed, ` +
        `${Math.round((Date.now() - t0) / 1000)}s elapsed`,
    );
    if (segment.known === 0) break;
    listed.push(...segment.listed);
  }

  if (listed.length < MIN_APPS) {
    throw new Error(`Only ${listed.length} apps, refusing to publish a partial list`);
  }

  // gibbed's list also has apps whose stats are hidden from the community
  // (e.g. Dota 2), which PICS can't tell apart anonymously, and hand-picked
  // "junk" / "mod" types, which win over ours. If gib.me is down, merging our
  // previous list keeps those apps: the list then only grows.
  let source = "gibbed's list";
  let extra = await fetchList(GIBBED_LIST_URL);
  if (!extra) {
    source = "the previously published list";
    extra = (await fetchList(PUBLISHED_LIST_URL)) ?? [];
  }

  const merged = new Map<number, string | null>(listed);
  let added = 0;
  for (const [id, type] of extra) {
    if (!merged.has(id)) added++;
    merged.set(id, type);
  }
  console.log(`${extra.length} apps in ${source}, ${added} not found by the crawl`);

  const games = [...merged]
    .sort((a, b) => a[0] - b[0])
    .map(([id, type]) => (type ? `<game type="${type}">${id}</game>` : `<game>${id}</game>`))
    .join("");
  await Bun.write(OUTPUT, `<?xml version="1.0"?>\n<games>${games}</games>\n`);
  console.log(`${merged.size} apps written to ${OUTPUT}`);
}

async function fetchList(url: string): Promise<Listed[] | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const apps = [...xml.matchAll(/<game(?: type="([^"]+)")?>(\d+)<\/game>/g)].map(
      (m) => [Number(m[2]), m[1] ?? null] as Listed,
    );
    if (apps.length === 0) throw new Error("no apps in the response");
    return apps;
  } catch (e) {
    console.log(`Could not fetch ${url}: ${(e as Error).message}`);
    return null;
  }
}

if (process.argv[2] === "segment") {
  const [start, end] = process.argv.slice(3, 5).map(Number);
  const result = await crawlSegment(start, end);
  await Bun.write(process.argv[5], JSON.stringify(result));
  console.log(`appids ${start}-${end}: done`);
  process.exit(0);
} else {
  // Something in the parent keeps the event loop alive once the crawl is
  // done, so exit explicitly.
  await crawlAll();
  process.exit(0);
}
