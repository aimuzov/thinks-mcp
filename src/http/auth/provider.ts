import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import {
	InvalidClientMetadataError,
	InvalidGrantError,
	InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { Response } from 'express'

import { isAllowedRedirectUri, type HttpConfig } from '#thinks/http/config'
import { loginPage } from '#thinks/http/pages'

import type { AuthStore } from './store.ts'
import { TTL, type Tokens } from './tokens.ts'

/**
 * The OAuth authorization server, with Telegram as the only way to log in.
 *
 * The SDK's router owns the protocol -- metadata, registration, PKCE, error
 * redirects. This class decides who the user is and what a token means.
 */
export class ThinksOAuthProvider implements OAuthServerProvider {
	constructor(
		private readonly cfg: HttpConfig,
		private readonly store: AuthStore,
		private readonly tokens: Tokens,
	) {}

	get clientsStore(): OAuthRegisteredClientsStore {
		return {
			getClient: (id) => this.store.getClient(id),
			registerClient: (client) => {
				const bad = client.redirect_uris.find((uri) => !isAllowedRedirectUri(this.cfg, uri))
				if (bad) {
					throw new InvalidClientMetadataError(`redirect_uri не разрешён: ${bad}`)
				}
				const full = client as OAuthClientInformationFull
				this.store.saveClient(full)
				return full
			},
		}
	}

	/**
	 * Show the Telegram login. The request is signed into the widget's auth URL
	 * and comes back to /authorize/callback, where the code is issued.
	 */
	async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
		const request = await this.tokens.sign('authorize', {
			sub: client.client_id,
			redirect_uri: params.redirectUri,
			code_challenge: params.codeChallenge,
			state: params.state ?? '',
		})
		const callback = new URL('/authorize/callback', this.cfg.publicUrl)
		callback.searchParams.set('request', request)

		res.type('html').send(
			loginPage(this.cfg, {
				authUrl: callback.href,
				clientName: client.client_name ?? '',
				redirectHost: new URL(params.redirectUri).host,
			}),
		)
	}

	async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
		const pending = this.store.peekCode(code)
		if (!pending || pending.clientId !== client.client_id) {
			throw new InvalidGrantError('Код недействителен')
		}
		return pending.codeChallenge
	}

	async exchangeAuthorizationCode(
		client: OAuthClientInformationFull,
		code: string,
		_verifier?: string,
		redirectUri?: string,
	): Promise<OAuthTokens> {
		const pending = this.store.takeCode(code)
		if (!pending || pending.clientId !== client.client_id) {
			throw new InvalidGrantError('Код недействителен')
		}
		if (redirectUri && redirectUri !== pending.redirectUri) {
			throw new InvalidGrantError('redirect_uri не совпадает')
		}
		return this.issue(pending.userId, client.client_id)
	}

	async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
		const claims = await this.tokens.verify('refresh', refreshToken)
		if (!claims || claims.client_id !== client.client_id) {
			throw new InvalidGrantError('Refresh-токен недействителен')
		}
		return this.issue(claims.sub, client.client_id)
	}

	async verifyAccessToken(token: string): Promise<AuthInfo> {
		const claims = await this.tokens.verify('access', token)
		if (!claims) throw new InvalidTokenError('Токен недействителен')
		return {
			token,
			clientId: String(claims.client_id),
			scopes: [],
			expiresAt: claims.exp,
			extra: { userId: claims.sub },
		}
	}

	private async issue(userId: string, clientId: string): Promise<OAuthTokens> {
		const claims = { sub: userId, client_id: clientId }
		return {
			access_token: await this.tokens.sign('access', claims),
			token_type: 'Bearer',
			expires_in: TTL.access,
			refresh_token: await this.tokens.sign('refresh', claims),
		}
	}
}
