// src/db/users.ts — D1 helper functions for the users table

import type { User } from './types.ts'

/** Look up a user by their hashed Bearer token. Returns null if not found. */
export async function getUserByTokenHash(
    db: D1Database,
    tokenHash: string,
): Promise<User | null> {
    const result = await db
        .prepare('SELECT * FROM users WHERE token_hash = ? LIMIT 1')
        .bind(tokenHash)
        .first<User>()
    return result ?? null
}

/** Look up a user by their slug_prefix (used to resolve namespaced short links). */
export async function getUserBySlugPrefix(
    db: D1Database,
    slugPrefix: string,
): Promise<User | null> {
    const result = await db
        .prepare('SELECT * FROM users WHERE slug_prefix = ? LIMIT 1')
        .bind(slugPrefix)
        .first<User>()
    return result ?? null
}

/** Create a new user. Returns the newly inserted row. */
export async function createUser(
    db: D1Database,
    data: {
        token_hash: string
        slug_prefix: string
        full_name?: string
        email?: string
        phone?: string
    },
): Promise<User> {
    const { token_hash, slug_prefix, full_name = null, email = null, phone = null } = data

    const result = await db
        .prepare(
            `INSERT INTO users (token_hash, slug_prefix, full_name, email, phone)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`,
        )
        .bind(token_hash, slug_prefix, full_name, email, phone)
        .first<User>()

    if (!result) throw new Error('Failed to create user')
    return result
}

/** Update a user's profile fields. Returns the updated row. */
export async function updateUser(
    db: D1Database,
    userId: number,
    data: Partial<{ slug_prefix: string; full_name: string; email: string; phone: string }>,
): Promise<User | null> {
    const fields = Object.keys(data) as (keyof typeof data)[]
    if (fields.length === 0) return null

    const setClauses = fields.map((f) => `${f} = ?`).join(', ')
    const values = fields.map((f) => data[f] ?? null)

    const result = await db
        .prepare(
            `UPDATE users
       SET ${setClauses}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?
       RETURNING *`,
        )
        .bind(...values, userId)
        .first<User>()

    return result ?? null
}
