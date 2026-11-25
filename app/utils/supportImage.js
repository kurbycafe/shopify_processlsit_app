export async function prepareAdminSupportPhoto(file, { preferWebP = true } = {}) {
  if (!file) return null;
  const supported = ['image/jpeg', 'image/png', 'image/webp'];
  const inferred = /\.(jpe?g|png|webp)$/i.test(file.name || '');
  if ((!supported.includes(file.type) && !(file.type === '' && inferred)) || file.size > 20 * 1024 * 1024) {
    throw new Error('20MB 이하 JPEG, PNG 또는 WebP 사진을 선택해주세요. HEIC 사진은 JPEG로 변환해주세요.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    for (const maxSide of [1200, 1000, 800, 640, 480, 320]) {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
      canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
      canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('사진을 처리하지 못했습니다. 다른 사진으로 다시 시도해주세요.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.68, 0.52, 0.38]) {
        let data = preferWebP ? canvas.toDataURL('image/webp', quality) : '';
        if (!data.startsWith('data:image/webp;base64,')) data = canvas.toDataURL('image/jpeg', quality);
        if ((data.startsWith('data:image/webp;base64,') || data.startsWith('data:image/jpeg;base64,')) && data.length <= 180000) return data;
      }
    }
    throw new Error('사진 용량을 줄이지 못했습니다. 다른 사진을 선택해주세요.');
  } catch (error) {
    if (error.name === 'EncodingError') throw new Error('사진을 읽지 못했습니다. JPEG, PNG 또는 WebP 사진을 선택해주세요.');
    throw error;
  } finally { URL.revokeObjectURL(url); }
}
