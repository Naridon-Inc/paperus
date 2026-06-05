export class Keychain {
  static getTeams() {
    try {
      const stored = localStorage.getItem('notionless_teams')
      return stored ? JSON.parse(stored) : []
    } catch (e) {
      console.error('Failed to load teams', e)
      return []
    }
  }

  static addTeam(name, secret) {
    const teams = this.getTeams()
    // Check for duplicates
    const existing = teams.findIndex(t => t.name === name)
    if (existing >= 0) {
      teams[existing].secret = secret // Update key
    } else {
      teams.push({ id: Date.now().toString(), name, secret })
    }
    this.saveTeams(teams)
  }

  static removeTeam(id) {
    const teams = this.getTeams().filter(t => t.id !== id)
    this.saveTeams(teams)
  }

  static saveTeams(teams) {
    localStorage.setItem('notionless_teams', JSON.stringify(teams))
  }
}
