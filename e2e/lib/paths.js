/**
 * CaskFS paths the pipeline writes for this run's collection, following
 * argonath's layout (docs/cask-conventions.md):
 *   bronze/<group>/<collection>/{manifest.json, latest/{by-ref,tree}/...}
 *   silver/<group>/<collection>/latest/tree/<item>/...
 *   gold/<project>/collections/<collection>/tree/<item>/item.jsonld.json
 *
 * @module paths
 */
import config from '../config.js';
import ctx from './run-context.js';

/**
 * argonath's slug rule (digtk.models.collection._slugify).
 *
 * @param {string} value - e.g. an entity title.
 * @returns {string} Slug.
 */
function slugify(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Collection-level roots.
 *
 * @param {string} [collection=ctx.collection] - Collection name.
 * @returns {Object} {bronze, latest, byRef, tree, silver, gold}.
 */
function roots(collection = ctx.collection) {
  const bronze = `/bronze/${ctx.group}/${collection}`;
  return {
    bronze,
    latest: `${bronze}/latest`,
    byRef: `${bronze}/latest/by-ref`,
    tree: `${bronze}/latest/tree`,
    silver: `/silver/${ctx.group}/${collection}`,
    gold: `/gold/${config.goldProject}/collections/${collection}`,
  };
}

/**
 * Paths for one item, by its current title.
 *
 * @param {Object} item - {ref, title}.
 * @param {string} [collection=ctx.collection] - Collection name.
 * @returns {Object} {byRef, tree, silver, gold, goldRecord}.
 */
function itemPaths(item, collection = ctx.collection) {
  const r = roots(collection);
  const slug = slugify(item.title);
  return {
    slug,
    byRef: `${r.byRef}/${item.ref}`,
    tree: `${r.tree}/${slug}`,
    silver: `${r.silver}/latest/tree/${slug}`,
    gold: `${r.gold}/tree/${slug}`,
    goldRecord: `${r.gold}/tree/${slug}/item.jsonld.json`,
  };
}

export { slugify, roots, itemPaths };
