/**
 * The contract between the gateway and a modality.
 *
 * A modality declares *data* — which gateway paths it owns and where they
 * forward to — rather than building an Express router itself. That keeps the
 * dependency arrow pointing one way (gateway -> modality) with no cycle, and
 * means adding a modality never requires editing the gateway.
 */

/** A single upstream forward with a path parameter appended, e.g. `/status/:jobId`. */
export interface ParamRoute {
  /** Gateway path, including the Express param token. */
  from: string;
  /** Upstream path; the param values are appended in `params` order. */
  to: string;
  /** Names of `req.params` keys to append, in order. */
  params: string[];
}

/** Everything a modality exposes through the gateway proxy. */
export interface ModalityRouteSpec {
  /** Human-readable id, used in logs and error messages. */
  id: string;
  /** POST routes: gateway path -> upstream path. */
  posts?: Record<string, string>;
  /** GET routes: gateway path -> upstream path. */
  gets?: Record<string, string>;
  /** GET routes carrying path parameters. */
  paramGets?: ParamRoute[];
  /**
   * Prefixes served by a catch-all passthrough, forwarding any sub-path
   * verbatim. Preferred for new modalities: one entry replaces a whole table
   * and cannot drift out of sync with the Python router.
   */
  wildcards?: WildcardMount[];
}

/** A catch-all mount forwarding every sub-path under `prefix`. */
export interface WildcardMount {
  /** Gateway prefixes to mount at (aliases allowed). */
  mountAt: string[];
  /** Upstream prefix that the gateway prefixes normalise to. */
  upstreamPrefix: string;
  /** Optional per-path timeout overrides, keyed by full upstream path. */
  timeouts?: Record<string, number>;
}
