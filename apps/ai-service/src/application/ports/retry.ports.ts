export interface DelayPort {
  wait(milliseconds: number): Promise<void>;
}

export interface JitterSource {
  next(): number;
}
