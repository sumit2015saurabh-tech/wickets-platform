#!/usr/bin/env node
/**
 * Seed all microservices after stack is up.
 * Run: node scripts/seed-all.js
 */
const SVC_KEY = process.env.SERVICE_API_KEY ?? 'internal-service-key-change-me';
const headers = { 'Content-Type': 'application/json', 'x-service-api-key': SVC_KEY };

async function post(url, body = {}) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  console.log(url, res.status, text.slice(0, 120));
}

async function main() {
  const auth = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001';
  const catalog = process.env.CATALOG_SERVICE_URL ?? 'http://localhost:3003';
  const odds = process.env.ODDS_SERVICE_URL ?? 'http://localhost:3004';
  const casino = process.env.CASINO_SERVICE_URL ?? 'http://localhost:3007';
  const promo = process.env.PROMOTIONS_SERVICE_URL ?? 'http://localhost:3008';
  const cms = process.env.CMS_SERVICE_URL ?? 'http://localhost:3011';

  await post(`${auth}/internal/seed-admin`);
  await post(`${catalog}/internal/seed`);
  await post(`${casino}/internal/seed`);
  await post(`${promo}/internal/seed`);
  await post(`${cms}/internal/seed`);

  const fixtures = await fetch(`${catalog}/fixtures`).then((r) => r.json());
  const fixture = fixtures.items?.[0];
  if (fixture) {
    await post(`${odds}/internal/seed-market`, {
      fixtureId: fixture.id,
      homeName: fixture.homeTeam.name,
      awayName: fixture.awayTeam.name,
    });
  }
  console.log('Seed complete.');
}

main().catch(console.error);
