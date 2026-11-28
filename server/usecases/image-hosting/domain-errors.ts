import {
  type ErrorLanguage,
  type ErrorText,
  englishMessage,
  localizeMessage,
  productMessage,
  textMessage,
} from '../ports'

const PROVIDER_FAILED: ErrorText = 'The custom-domain provider test failed. Check its settings.'
const DOMAIN_NOT_VERIFIED: ErrorText =
  'The custom domain is not verified yet. Check that its DNS record points to the target shown.'

// A provider or domain error is stored and shown as a product message: the specific
// one when the catalog knows the failure, the generic one otherwise. The provider's
// own text goes to the server log only. Rows stored before this rule hold that raw
// text, which maps to the generic message when read.
export const providerErrorMessage = (text: string) => englishMessage(productMessage(text, PROVIDER_FAILED))

export const domainErrorMessage = (text: string | null) =>
  text ? englishMessage(productMessage(text, DOMAIN_NOT_VERIFIED)) : null

/** The product message to store for a domain, logging the provider's text it replaces. */
export function storedDomainError(hostname: string, text: string | null): string | null {
  const message = domainErrorMessage(text)
  if (message !== text) console.warn(`image_domain.domain.error host=${hostname} error=${text}`)
  return message
}

/** A stored product message in the request's language. */
export const localizeStoredError = (text: string | null, language: ErrorLanguage) =>
  text ? localizeMessage(textMessage(text), language) : null
