import { Source } from '../task.js';
import { Config } from '../config.js';

export interface Candidate {
  title: string;
  source: Source;
  sourceUrl: string | null;
}

export interface Adapter {
  /** Config key under `adapters:` that enables this adapter. */
  name: string;
  discover(cfg: Config): Promise<Candidate[]>;
}
