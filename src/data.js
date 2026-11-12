import fs from 'node:fs';
import path from 'node:path';
const dataPath = path.resolve('public/data/journalata.json');
const fallback = { updatedAt: null, articles: [], pages: [], stats: [], sourceStatus: {} };
export function getJournalData(){try{return JSON.parse(fs.readFileSync(dataPath,'utf8'))}catch{return fallback}}
