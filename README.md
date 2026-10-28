# steam-app-list

The list of Steam apps that have achievements or stats, refreshed daily, in the
`games.xml` format of [gibbed's SAM](https://github.com/gibbed/SteamAchievementManager).
[SamRewritten](https://github.com/PaulCombal/SamRewritten) uses it to know which of
your games it can manage.

**Download:** https://raw.githubusercontent.com/PaulCombal/steam-app-list/list/games.xml

## How it is built

A GitHub Action logs into Steam anonymously and asks the product-info service
(PICS, the data SteamDB uses) about every appid, 5,000 at a time. An app is
listed when Steam exposes community stats for it (`common.community_visible_stats`)
and it is a game, application, demo or mod. Demos and mods carry `type="demo"` /
`type="mod"`.

No Steam account or API key is needed. The anonymous change feed only covers
the last few minutes, so every run is a full crawl (about 15 minutes).

## Running it locally

```sh
bun install
bun crawl.ts   # writes games.xml
```
