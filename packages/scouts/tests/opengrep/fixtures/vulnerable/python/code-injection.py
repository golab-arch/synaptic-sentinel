# Fixture deliberadamente vulnerable - NO es codigo de produccion.
# Se usa para validar la deteccion del OpenGrepScout (CWE-95, CWE-78).

import subprocess


def run_user_code(user_input):
    # exec() sobre entrada no confiable: inyeccion de codigo.
    exec(user_input)


def run_command(cmd):
    # subprocess con shell=True: inyeccion de comandos del sistema operativo.
    subprocess.run(cmd, shell=True)
