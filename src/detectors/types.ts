export interface Detector {
  /** Unique label, used in token format e.g. "EMAIL", "SSN" */
  readonly type: string;

  /**
   * Find all matches in the given text. Returned positions are absolute
   * offsets into the input string.
   */
  detect(text: string): DetectorMatch[];
}

export interface DetectorMatch {
  start: number;
  end: number;
  value: string;
}
