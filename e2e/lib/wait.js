/**
 * Polling primitives for waiting on an asynchronous pipeline.
 *
 * waitFor() keeps calling a probe until it returns a truthy value. stage()
 * wraps it as a named step with its own timeout: it logs how long the step
 * took, checks for pipeline failures on every poll (fail fast), and dumps
 * diagnostics if it times out. A failure therefore names the hop that
 * stalled (e.g. "gold written") rather than just "timed out".
 *
 * @module wait
 */
import config from '../config.js';
import { dumpDiagnostics } from './diagnostics.js';

/**
 * Sleep.
 *
 * @param {number} ms - Milliseconds.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Thrown when the pipeline reports a failure while a stage is waiting.
 */
class PipelineFailure extends Error {}

/**
 * Call `probe` until it returns a truthy value or the timeout passes.
 *
 * @param {Function} probe - async () => value; truthy ends the wait. Errors are
 *   treated as "not yet" and kept as the last result.
 * @param {Object} [opts={}] - Options.
 * @param {string} [opts.label='condition'] - Name used in errors.
 * @param {number} [opts.timeout] - Ms before giving up (default config.timing.stage).
 * @param {number} [opts.interval] - Ms between polls (default config.timing.interval).
 * @param {Function} [opts.failFast] - async () => void; may throw PipelineFailure to abort early.
 * @returns {Promise<*>} The probe's truthy value.
 * @throws {Error} On timeout (with the last probe result) or a fail-fast failure.
 */
async function waitFor(probe, opts = {}) {
  const label = opts.label || 'condition';
  const timeout = opts.timeout ?? config.timing.stage;
  const interval = opts.interval ?? config.timing.interval;
  const start = Date.now();
  let last;

  for (;;) {
    try {
      last = await probe();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (opts.failFast) await opts.failFast();
    if (Date.now() - start > timeout) {
      const detail = last instanceof Error ? last.message : JSON.stringify(last);
      throw new Error(`Timed out after ${Math.round(timeout / 1000)}s waiting for ${label}; last probe: ${detail}`);
    }
    await sleep(interval);
  }
}

/**
 * Run one named pipeline stage: wait for its probe, log its duration, and
 * dump diagnostics if it fails.
 *
 * @param {string} label - Stage name, e.g. 'item one indexed in ES'.
 * @param {Function} probe - See waitFor().
 * @param {Object} [opts={}] - waitFor() options.
 * @returns {Promise<*>} The probe's truthy value.
 */
async function stage(label, probe, opts = {}) {
  const start = Date.now();
  try {
    const value = await waitFor(probe, { ...opts, label });
    console.log(`      stage ok: ${label} (${Math.round((Date.now() - start) / 1000)}s)`);
    return value;
  } catch (e) {
    console.log(`      stage FAILED: ${label} (${Math.round((Date.now() - start) / 1000)}s)`);
    const dir = await dumpDiagnostics(label).catch(err => `(diagnostics failed: ${err.message})`);
    e.message = `[${label}] ${e.message}\n      diagnostics: ${dir}`;
    throw e;
  }
}

export { waitFor, stage, sleep, PipelineFailure };
