ALTER TABLE oauth_authorization_requests ADD COLUMN wallet_nonce TEXT NOT NULL DEFAULT '';
ALTER TABLE oauth_authorization_codes ADD COLUMN principal_address TEXT NOT NULL DEFAULT '';
ALTER TABLE oauth_tokens ADD COLUMN principal_address TEXT NOT NULL DEFAULT '';
