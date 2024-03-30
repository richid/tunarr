export function makeFilterComplex(
  streamName: string,
  operation: string,
  mappedStreamName: string,
) {
  return `[${streamName}]${operation}[${mappedStreamName}]`;
}

export class FilterComplexBuilder {
  #buf: string[] = [];
  #currentName: string = 'video';

  constructor(initialStream: string) {
    this.#buf.push(makeFilterComplex(initialStream, 'null', this.#currentName));
  }

  reset(streamName: string) {
    this.#buf = [];
    this.#currentName = streamName;
    return this;
  }

  add(operation: string, mappedStreamName: string) {
    this.#buf.push(
      makeFilterComplex(this.#currentName, operation, mappedStreamName),
    );
    this.#currentName = mappedStreamName;
    // Chainable
    return this;
  }

  build() {
    return this.#buf.join(';');
  }

  get currentName() {
    return this.#currentName;
  }
}
