// SPDX-License-Identifier: Apache-2.0
import { createServer, type Server } from 'node:http';
import type { FastifyInstance } from 'fastify';

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const escapeLabel = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');

interface Series {
  count: number;
  sum: number;
  buckets: number[];
}

/**
 * Request counters and durations in the Prometheus text format, plus the
 * numbers an operator wants on a dashboard. Labels are the route *template*
 * (`/api/courses/:id`), never the concrete path, so cardinality stays small.
 */
export class Metrics {
  readonly #requests = new Map<string, number>();
  readonly #durations = new Map<string, Series>();
  readonly #gauges: (() => Promise<Record<string, number>>)[] = [];
  readonly #started = Date.now();

  /** Adds gauges read at scrape time (for example counts from the database). */
  addGauges(read: () => Promise<Record<string, number>>): void {
    this.#gauges.push(read);
  }

  observe(method: string, route: string, status: number, seconds: number): void {
    const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}"`;
    const key = `${labels},status="${status}"`;
    this.#requests.set(key, (this.#requests.get(key) ?? 0) + 1);
    const series = this.#durations.get(labels) ?? { count: 0, sum: 0, buckets: BUCKETS.map(() => 0) };
    series.count += 1;
    series.sum += seconds;
    BUCKETS.forEach((bound, i) => {
      if (seconds <= bound) series.buckets[i] = (series.buckets[i] ?? 0) + 1;
    });
    this.#durations.set(labels, series);
  }

  attach(app: FastifyInstance): void {
    app.addHook('onResponse', (request, reply, done) => {
      // Unknown paths (404) all count as one route, so scanners cannot create series.
      this.observe(
        request.method,
        request.routeOptions.url ?? 'unmatched',
        reply.statusCode,
        reply.elapsedTime / 1000,
      );
      done();
    });
  }

  async render(): Promise<string> {
    const lines: string[] = [
      '# HELP coursecraft_http_requests_total HTTP requests by route template and status.',
      '# TYPE coursecraft_http_requests_total counter',
    ];
    for (const [key, value] of [...this.#requests].sort())
      lines.push(`coursecraft_http_requests_total{${key}} ${value}`);
    lines.push(
      '# HELP coursecraft_http_request_duration_seconds Time to answer a request.',
      '# TYPE coursecraft_http_request_duration_seconds histogram',
    );
    for (const [labels, series] of [...this.#durations].sort()) {
      BUCKETS.forEach((bound, i) =>
        lines.push(
          `coursecraft_http_request_duration_seconds_bucket{${labels},le="${bound}"} ${series.buckets[i] ?? 0}`,
        ),
      );
      lines.push(
        `coursecraft_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${series.count}`,
        `coursecraft_http_request_duration_seconds_sum{${labels}} ${series.sum}`,
        `coursecraft_http_request_duration_seconds_count{${labels}} ${series.count}`,
      );
    }
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const process_: [string, string, number][] = [
      ['process_resident_memory_bytes', 'gauge', memory.rss],
      ['nodejs_heap_used_bytes', 'gauge', memory.heapUsed],
      ['process_cpu_seconds_total', 'counter', (cpu.user + cpu.system) / 1e6],
      ['process_uptime_seconds', 'gauge', (Date.now() - this.#started) / 1000],
    ];
    for (const [name, type, value] of process_) lines.push(`# TYPE ${name} ${type}`, `${name} ${value}`);
    for (const read of this.#gauges) {
      try {
        for (const [name, value] of Object.entries(await read()))
          lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
      } catch {
        // A failing gauge must not take the whole scrape down.
      }
    }
    return `${lines.join('\n')}\n`;
  }
}

/** A separate listener (not the public one), so metrics never leave the cluster by accident. */
export function serveMetrics(metrics: Metrics, host: string, port: number): Server {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url?.split('?')[0] !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    metrics.render().then(
      (body) =>
        response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }).end(body),
      () => response.writeHead(500).end(),
    );
  });
  server.listen(port, host);
  return server;
}
