class ServiceChecker {
    static async isServiceRunning(url) {
      try {
        const response = await fetch(url, { method: 'GET' });
        return response.ok;
      } catch {
        return false;
      }
    }
  }

  module.exports = ServiceChecker;