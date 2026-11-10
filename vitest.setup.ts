// jsdom lacks object URLs; components that export files need them.
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => {};
}
