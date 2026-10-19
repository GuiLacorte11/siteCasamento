export function catalogGift(gift) {
  return { ...gift, physical_enabled: gift.physical_enabled ?? (gift.category === 'casa' ? 1 : 0), product_url: gift.product_url || '' };
}

export function productFields(input, previous = {}) {
  if (input.physical_enabled !== undefined && ![true, false, 0, 1].includes(input.physical_enabled)) {
    throw Object.assign(new Error('Revise a opção de presente físico.'), { status: 400 });
  }
  const physical_enabled = Number(Boolean(input.physical_enabled ?? catalogGift({ category: input.category, ...previous }).physical_enabled));
  let product_url = input.product_url ?? previous.product_url ?? '';
  if (typeof product_url !== 'string' || product_url.length > 2000) {
    throw Object.assign(new Error('Informe um link de produto válido.'), { status: 400 });
  }
  product_url = product_url.trim();
  if (product_url) {
    try {
      const url = new URL(product_url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
      product_url = url.href;
    } catch {
      throw Object.assign(new Error('Use o endereço completo da loja, começando com https://.'), { status: 400 });
    }
  }
  return { physical_enabled, product_url };
}
