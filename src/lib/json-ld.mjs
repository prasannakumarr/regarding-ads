// JSON strings can contain closing script tags, even when valid JSON.
export const serializeJsonLd = value => JSON.stringify(value).replace(/</g, '\\u003c');
