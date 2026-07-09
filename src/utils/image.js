// 图片压缩：长边缩到 1280，转 jpeg base64（不含 data: 前缀）
export function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = (e) => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        let { width, height } = img
        const MAX = 1280
        if (width > MAX || height > MAX) {
          if (width > height) {
            height = Math.round((height * MAX) / width)
            width = MAX
          } else {
            width = Math.round((width * MAX) / height)
            height = MAX
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1]
        resolve({ base64, previewUrl: `data:image/jpeg;base64,${base64}` })
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}
