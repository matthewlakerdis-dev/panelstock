export function validEmployeePhoto(value) {
  return typeof value === 'string' && value.length <= 1500000 &&
    /^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(value);
}
