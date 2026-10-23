import { readFileSync } from 'node:fs';
import process from 'node:process';
import console from 'node:console';

const paths = process.argv.slice(2);
if (!paths.length) throw Error('Pass one or more server-costs JSON artifacts');
const quantile = (values, fraction) => values.slice().sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
for (const path of paths) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const groups = new Map();
  for (const sample of report.samples.filter((row) => row.name.startsWith('measured '))) {
    const rows = groups.get(sample.name) ?? [];
    rows.push(sample);
    groups.set(sample.name, rows);
  }
  console.log(
    JSON.stringify({
      path,
      scale: report.scale,
      backlog: report.backlog ?? false,
      groups: [...groups].map(([name, rows]) => ({
        name,
        count: rows.length,
        metrics: Object.fromEntries(
          ['ms', 'calls', 'sqlMs', 'bytes', 'gzipBytes'].map((metric) => {
            const values = rows.map((row) => row[metric]);
            if (values.some((value) => !Number.isFinite(value))) throw Error(`Missing ${metric}: ${name}`);
            return [metric, { median: quantile(values, 0.5), p95: quantile(values, 0.95), max: Math.max(...values) }];
          }),
        ),
      })),
    }),
  );
}
