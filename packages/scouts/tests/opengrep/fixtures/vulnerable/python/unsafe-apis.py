# Fixture deliberadamente vulnerable - NO es codigo de produccion.
# Valida la deteccion de inyeccion de comandos (CWE-78), deserializacion
# insegura (CWE-502) y criptografia debil (CWE-327) del OpenGrepScout.

import hashlib
import os
import pickle

import yaml


def run_command(cmd):
    # os.system() ejecuta cmd en un shell: inyeccion de comandos.
    os.system(cmd)


def load_config(raw):
    # yaml.load() sin SafeLoader puede instanciar objetos arbitrarios.
    return yaml.load(raw)


def load_session(blob):
    # pickle.loads() sobre datos no confiables: deserializacion insegura.
    return pickle.loads(blob)


def fingerprint(password):
    # MD5 es un hash criptograficamente debil.
    return hashlib.md5(password.encode()).hexdigest()
