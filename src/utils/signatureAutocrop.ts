export function autocropSignature(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = 0;
      let maxY = 0;

      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const index = (y * canvas.width + x) * 4;
          const alpha = pixels[index + 3];

          if (alpha > 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (minX > maxX || minY > maxY) {
        resolve(dataUrl);
        return;
      }

      const paddingTop = 10;
      const paddingBottom = 10;
      const paddingLeft = 5;
      const paddingRight = 5;

      const cropX = Math.max(0, minX - paddingLeft);
      const cropY = Math.max(0, minY - paddingTop);
      const cropWidth = Math.min(canvas.width - cropX, (maxX - minX + 1) + paddingLeft + paddingRight);
      const cropHeight = Math.min(canvas.height - cropY, (maxY - minY + 1) + paddingTop + paddingBottom);

      const croppedCanvas = document.createElement('canvas');
      const croppedCtx = croppedCanvas.getContext('2d');

      if (!croppedCtx) {
        reject(new Error('Could not get cropped canvas context'));
        return;
      }

      croppedCanvas.width = cropWidth;
      croppedCanvas.height = cropHeight;

      croppedCtx.drawImage(
        canvas,
        cropX, cropY, cropWidth, cropHeight,
        0, 0, cropWidth, cropHeight
      );

      resolve(croppedCanvas.toDataURL());
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    img.src = dataUrl;
  });
}
