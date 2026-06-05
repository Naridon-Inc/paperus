const Store = {
  projectPath: '',
  init(p) {
    this.projectPath = p;
  },
  async get(key) {
    return await window.api.getSettings(`windows.${this.projectPath}.${key}`);
  },
  async set(key, value) {
    return await window.api.setSettings(`windows.${this.projectPath}.${key}`, value);
  },
  async has(key) {
    return await window.api.hasSettings(`windows.${this.projectPath}.${key}`);
  }
}

export default Store;
