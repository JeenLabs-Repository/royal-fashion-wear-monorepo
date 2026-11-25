// The vendor's sign-in token lives in this variable and nowhere else: no
// cookie and no browser storage. The portal shares its hostname with the admin
// dashboard, so a cookie written here could replace a staff session in the same
// browser. A page refresh drops the token and the vendor signs in again.
let accessToken: string | null = null

export const getToken = (): string | null => accessToken

export const setToken = (token: string): void => {
  accessToken = token
}

export const clearToken = (): void => {
  accessToken = null
}
