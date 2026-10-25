/**
 * Collects PTY output and hands it on at most once per `intervalMs` (one IPC message per frame
 * instead of one per read), or straight away once `maxBytes` have piled up so a flood of
 * output (`cat` of a big file) still moves in bounded messages.
 */
export class OutputBatcher {
  private chunks: string[] = []
  private size = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly flushTo: (data: string) => void,
    private readonly intervalMs = 16,
    private readonly maxBytes = 256 * 1024,
  ) {}

  push(data: string): void {
    if (!data) return
    this.chunks.push(data)
    this.size += data.length
    if (this.size >= this.maxBytes) {
      this.flush()
      return
    }
    this.timer ??= setTimeout(() => this.flush(), this.intervalMs)
  }

  /** Sends what is waiting now (also used before an exit event, so no output is lost). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.chunks.length === 0) return
    const data = this.chunks.join('')
    this.chunks = []
    this.size = 0
    this.flushTo(data)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.chunks = []
    this.size = 0
  }
}
