import type {
  DelayPort,
  JitterSource,
} from "../../application/ports/retry.ports";

export class SystemDelay implements DelayPort {
  wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}

export class RandomJitterSource implements JitterSource {
  next(): number {
    return Math.random();
  }
}
