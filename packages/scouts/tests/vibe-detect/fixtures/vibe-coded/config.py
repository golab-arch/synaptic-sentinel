# Fixture deliberadamente vibe-coded - NO es codigo de produccion.
# Reproduce anti-patrones tipicos de codigo generado por IA aceptado sin
# revisar. Dispara varios detectores del VibeDetectScout.
import requests

API_KEY = "your-api-key-here"
DEBUG = True


def fetch(url):
    # TODO: add input validation and authentication before shipping
    return requests.get(url, verify=False)
