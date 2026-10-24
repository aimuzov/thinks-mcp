import { closeSync, openSync, readSync } from 'node:fs'

const QUOTE = 0x22
const BACKSLASH = 0x5c
const COMMA = 0x2c
const COLON = 0x3a
const LBRACE = 0x7b
const RBRACE = 0x7d
const LBRACKET = 0x5b
const RBRACKET = 0x5d

const isSpace = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09

/**
 * A pull scanner over a JSON file that walks objects and arrays without
 * materializing them. The caller descends with `entries()` and `items()` and
 * turns only the leaves it needs into values, so memory stays bounded by the
 * largest single value parsed rather than by the file.
 *
 * Works on bytes: every structural character is ASCII and every byte of a
 * multi-byte UTF-8 sequence is above 0x7f, so they never collide, and a
 * sequence split across two chunks is glued back before decoding.
 */
export class JsonScanner {
	private buf: Buffer = Buffer.alloc(0)
	private pos = 0
	private offset = 0
	private readonly fd: number
	private readonly chunkSize: number

	constructor(path: string, chunkSize = 1 << 20) {
		this.chunkSize = chunkSize
		this.fd = openSync(path, 'r')
	}

	close(): void {
		closeSync(this.fd)
	}

	/** Iterate an object's keys. The caller must consume each key's value. */
	*entries(): Generator<string> {
		if (this.skipNull()) return

		this.expect(LBRACE)

		if (this.consume(RBRACE)) return

		do {
			const key = this.value()

			if (typeof key !== 'string') this.fail('ключ объекта')

			this.expect(COLON)
			yield key
		} while (this.consume(COMMA))

		this.expect(RBRACE)
	}

	/** Iterate an array. The caller must consume one value per step. */
	*items(): Generator<void> {
		if (this.skipNull()) return

		this.expect(LBRACKET)

		if (this.consume(RBRACKET)) return

		do yield
		while (this.consume(COMMA))

		this.expect(RBRACKET)
	}

	/** Parse the next value in full. */
	value(): unknown {
		return JSON.parse(this.scan(true).toString('utf8'))
	}

	/** Step over the next value without keeping it. */
	skip(): void {
		this.scan(false)
	}

	private refill(): boolean {
		this.offset += this.buf.length
		const chunk = Buffer.allocUnsafe(this.chunkSize)
		const n = readSync(this.fd, chunk, 0, this.chunkSize, null)

		this.buf = chunk.subarray(0, n)
		this.pos = 0

		return n > 0
	}

	/** The next non-whitespace byte, or -1 at the end of the file. */
	private peek(): number {
		for (;;) {
			if (this.pos >= this.buf.length && !this.refill()) return -1

			const c = this.buf[this.pos]!

			if (!isSpace(c)) return c

			this.pos++
		}
	}

	private consume(c: number): boolean {
		if (this.peek() !== c) return false

		this.pos++

		return true
	}

	private expect(c: number): void {
		if (!this.consume(c)) this.fail(`"${String.fromCharCode(c)}"`)
	}

	private skipNull(): boolean {
		if (this.peek() !== 0x6e) return false

		if (this.value() !== null) this.fail('null')

		return true
	}

	private fail(what: string): never {
		throw new SyntaxError(`Битый JSON: ожидался ${what} на байте ${this.offset + this.pos}`)
	}

	/**
	 * Find the end of the value starting at the cursor and move past it,
	 * returning its bytes when asked to keep them.
	 */
	private scan(keep: boolean): Buffer {
		const first = this.peek()

		if (first === -1) this.fail('значение')

		const scalar = first !== LBRACE && first !== LBRACKET && first !== QUOTE
		const parts: Buffer[] = []
		let start = this.pos
		let depth = 0
		let inString = false
		let escaped = false

		for (;;) {
			if (this.pos >= this.buf.length) {
				if (keep) parts.push(this.buf.subarray(start))

				if (!this.refill()) {
					if (scalar) break

					this.fail('конец значения')
				}

				start = 0
			}

			const c = this.buf[this.pos]!

			if (inString) {
				this.pos++

				if (escaped) escaped = false
				else if (c === BACKSLASH) escaped = true
				else if (c === QUOTE) {
					inString = false

					if (depth === 0) break
				}
			} else if (scalar) {
				if (c === COMMA || c === RBRACE || c === RBRACKET || isSpace(c)) break

				this.pos++
			} else {
				this.pos++

				if (c === QUOTE) inString = true
				else if (c === LBRACE || c === LBRACKET) depth++
				else if ((c === RBRACE || c === RBRACKET) && --depth === 0) break
			}
		}

		if (!keep) return Buffer.alloc(0)

		parts.push(this.buf.subarray(start, this.pos))

		return parts.length === 1 ? parts[0]! : Buffer.concat(parts)
	}
}
