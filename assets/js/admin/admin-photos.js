(() => {
  const MAX_IMAGE_EDGE = 1280;
  const MAX_SOURCE_SIZE = 15 * 1024 * 1024;
  const MAX_STORED_SIZE = 900 * 1024;

  const toDataUrl = async (file) => {
    if (!file) return null;
    if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
    if (file.size > MAX_SOURCE_SIZE) throw new Error("Choose an image smaller than 15 MB.");

    let image;
    try {
      image = await createImageBitmap(file);
    } catch {
      throw new Error("The selected image could not be opened.");
    }

    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
    if (!blob) throw new Error("The selected image could not be compressed.");
    if (blob.size > MAX_STORED_SIZE) throw new Error("This photo is too large to store. Choose a smaller image.");

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("The selected image could not be read."));
      reader.readAsDataURL(blob);
    });
  };

  const bindPreview = (input, preview) => {
    if (!input || !preview) return;
    let previewUrl = null;

    input.addEventListener("change", () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) {
        preview.removeAttribute("src");
        preview.hidden = true;
        return;
      }
      previewUrl = URL.createObjectURL(file);
      preview.src = previewUrl;
      preview.hidden = false;
    });
  };

  window.CampusPhotoTools = { toDataUrl, bindPreview };
})();
