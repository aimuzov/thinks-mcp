import { jwtVerify, SignJWT } from 'jose'

/**
 * Every signed thing the server hands out, told apart by `kind` so one can
 * never stand in for another: a session cookie is not an access token, and an
 * access token cannot be refreshed.
 */
export type TokenKind = 'access' | 'refresh' | 'session' | 'authorize'

export const TTL: Record<TokenKind, number> = {
	access: 60 * 60,
	refresh: 30 * 24 * 60 * 60,
	session: 7 * 24 * 60 * 60,
	// The authorize request carried through the Telegram widget round trip.
	authorize: 10 * 60,
}

export interface TokenClaims {
	sub: string
	[claim: string]: unknown
}

export class Tokens {
	private readonly key: Uint8Array

	constructor(
		secret: string,
		private readonly issuer: string,
	) {
		this.key = new TextEncoder().encode(secret)
	}

	sign(kind: TokenKind, claims: TokenClaims): Promise<string> {
		return new SignJWT({ ...claims, kind })
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuer(this.issuer)
			.setIssuedAt()
			.setExpirationTime(`${TTL[kind]}s`)
			.sign(this.key)
	}

	/** The claims, or null for anything forged, expired or of another kind. */
	async verify(kind: TokenKind, token: string): Promise<(TokenClaims & { exp: number }) | null> {
		try {
			const { payload } = await jwtVerify(token, this.key, {
				issuer: this.issuer,
				algorithms: ['HS256'],
			})
			if (payload.kind !== kind || typeof payload.sub !== 'string') return null
			return payload as TokenClaims & { exp: number }
		} catch {
			return null
		}
	}
}
