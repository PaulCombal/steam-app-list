# steam-app-list

The list of Steam apps that have achievements or stats, refreshed daily, in the
`games.xml` format of [gibbed's SAM](https://github.com/gibbed/SteamAchievementManager).
[SamRewritten](https://github.com/PaulCombal/SamRewritten) uses it to know which of
your games it can manage.

**Download:** https://raw.githubusercontent.com/PaulCombal/steam-app-list/list/games.xml

## How it is built

The list lives on the [`list` branch](https://github.com/PaulCombal/steam-app-list/tree/list),
which holds only `games.xml` and is replaced by a single commit on each run.

A GitHub Action logs into Steam anonymously and asks the product-info service
(PICS, the data SteamDB uses) about every appid, 5,000 at a time. An app is
listed when Steam exposes community stats for it (`common.community_visible_stats`)
and it is a game, application, demo or mod. Demos and mods carry `type="demo"` /
`type="mod"`.

Steam doesn't flag apps whose stats are hidden from the community (Dota 2, for
example), and an anonymous session can't fetch stats schemas to find them. So
each run also merges in [gibbed's list](https://gib.me/sam/games.xml) when it is
reachable; where both list an app, gibbed's type wins. If gib.me is down, the
crawled list is published alone.

No Steam account or API key is needed. The anonymous change feed only covers
the last few minutes, so every run is a full crawl (about 15 minutes).

## Running it locally

```sh
bun install
bun crawl.ts   # writes games.xml
```
