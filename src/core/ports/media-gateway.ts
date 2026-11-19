export interface MediaGateway {
  /** Authorize the explicitly opened file before publishing its display URL. */
  prepareSource(path: string): Promise<string>;
}
