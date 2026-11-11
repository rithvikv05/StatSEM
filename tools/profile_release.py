"""Profile an isolated macOS release app and its sidecar using native counters.

Usage: python3 tools/profile_release.py APP_PATH OUTPUT_DIRECTORY [SCENARIO]
Only benchmark-owned processes and temporary project files are touched.
"""
import ctypes
import csv
import http.client
import json
import os
from pathlib import Path
import random
import signal
import subprocess
import sys
import threading
import time
import urllib.parse

LIB = ctypes.CDLL(None, use_errno=True)
RESPONSIBLE = LIB.responsibility_get_pid_responsible_for_pid
RESPONSIBLE.argtypes = [ctypes.c_int]
RESPONSIBLE.restype = ctypes.c_int
FIELDS = ['user', 'system', 'idle', 'interrupt', 'pageins', 'wired', 'resident',
          'footprint', 'start', 'exit', 'child_user', 'child_system', 'child_idle',
          'child_interrupt', 'child_pageins', 'child_elapsed', 'read', 'written']


class Timebase(ctypes.Structure):
    _fields_ = [('numer', ctypes.c_uint32), ('denom', ctypes.c_uint32)]


TIMEBASE = Timebase()
LIB.mach_timebase_info(ctypes.byref(TIMEBASE))
CLOCK_NS_PER_TICK = TIMEBASE.numer / TIMEBASE.denom


class Usage(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_uint8 * 16)] + [(x, ctypes.c_uint64) for x in FIELDS]


def processes():
    output = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,comm='], text=True)
    return {int(parts[0]): (int(parts[1]), parts[2]) for line in output.splitlines()
            if len(parts := line.strip().split(None, 2)) == 3}


def usage(pid):
    value = Usage()
    return value if LIB.proc_pid_rusage(pid, 2, ctypes.byref(value)) == 0 else None


def terminate(pid):
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass


class Monitor:
    def __init__(self, root, output):
        self.root, self.output = root, output
        self.samples, self.members, self.previous = [], {}, {}
        self.stop = threading.Event()
        self.started = time.monotonic()
        self.phase = 'startup'
        self.limit_gib = 3.0
        self.abort_reason = None
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self):
        previous_time = time.monotonic()
        while not self.stop.is_set():
            now = time.monotonic()
            table = processes()
            owned = {self.root}
            for _ in range(4):
                owned.update(pid for pid, (parent, _) in table.items() if parent in owned)
            owned.update(pid for pid, (_, name) in table.items()
                         if 'com.apple.WebKit.' in name and RESPONSIBLE(pid) == self.root)
            total_cpu = footprint = resident = 0
            for pid in owned:
                value = usage(pid)
                if value is None:
                    continue
                self.members[pid] = table.get(pid, (0, 'exited'))[1]
                current = value.user + value.system
                if pid in self.previous:
                    total_cpu += max(0, current - self.previous[pid])
                self.previous[pid] = current
                footprint += value.footprint
                resident += value.resident
            self.samples.append(dict(seconds=now-self.started, phase=self.phase,
                                     footprint_mib=footprint/2**20, rss_mib=resident/2**20,
                                     cpu_percent=total_cpu*CLOCK_NS_PER_TICK/1e9/max(now-previous_time, .001)*100,
                                     processes=len(owned)))
            previous_time = now
            if footprint > self.limit_gib * 2**30 and self.abort_reason is None:
                self.abort_reason = f'Exceeded {self.limit_gib:g} GiB aggregate physical footprint'
                for pid, name in self.members.items():
                    if 'statsem-backend' in name:
                        terminate(pid)
            self.stop.wait(.25)

    def finish(self):
        self.stop.set()
        self.thread.join()
        with self.output.open('w') as file:
            writer = csv.DictWriter(file, fieldnames=self.samples[0].keys())
            writer.writeheader()
            writer.writerows(self.samples)
        summaries = {}
        for phase in dict.fromkeys(s['phase'] for s in self.samples):
            samples = [s for s in self.samples if s['phase'] == phase]
            summaries[phase] = dict(
                peak_footprint_mib=max(s['footprint_mib'] for s in samples),
                peak_rss_mib=max(s['rss_mib'] for s in samples),
                peak_cpu_percent=max(s['cpu_percent'] for s in samples),
                mean_cpu_percent=sum(s['cpu_percent'] for s in samples)/len(samples),
                samples=len(samples))
        return dict(phases=summaries, processes=self.members, abort_reason=self.abort_reason)


def make_payload(path, rows, project, bootstrap):
    columns = [f'x{i}' for i in range(100)]
    spec = dict(
        constructs=[dict(id=f'C{i}', name=f'C{i}', type='reflective',
                         indicators=columns[i*5:i*5+5]) for i in range(20)],
        indicators=[dict(id=c, column=c) for c in columns],
        paths=[{'from': f'C{i-1}', 'to': f'C{i}'} for i in range(1, 20)])
    header = dict(project_path=str(project), columns=columns, spec=spec,
                  n_boot=10000, seed=42, max_iter=300, tol=1e-7)
    rng = random.Random(42)
    ring = []
    for _ in range(min(rows, 4096)):
        latent, row = 0., []
        for _ in range(20):
            latent = .45*latent + rng.gauss(0, 1)
            row.extend(max(1, min(7, round(4 + latent + rng.gauss(0, .65)))) for _ in range(5))
        ring.append(json.dumps(row, separators=(',', ':')).encode())
    with path.open('wb') as file:
        file.write(json.dumps(header, separators=(',', ':')).encode()[:-1] + b',"rows":[')
        for index in range(rows):
            if index:
                file.write(b',')
            file.write(ring[index % len(ring)])
        file.write(b']}')
    return spec


def request(port, route, body=None, payload=None, timeout=90):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    try:
        if payload:
            connection.putrequest('POST', route)
            connection.putheader('Content-Type', 'application/json')
            connection.putheader('Content-Length', str(payload.stat().st_size))
            connection.endheaders()
            with payload.open('rb') as file:
                while chunk := file.read(1024*1024):
                    connection.send(chunk)
        else:
            connection.request('POST' if body is not None else 'GET', route,
                               json.dumps(body) if body is not None else None,
                               {'Content-Type': 'application/json'})
        response = connection.getresponse()
        result = json.loads(response.read())
        if response.status != 200 or result.get('error'):
            raise RuntimeError(result.get('error', result))
        return result
    finally:
        connection.close()


def run(app, output, name, rows=0, bootstrap=False, duration=45):
    directory = output/name
    directory.mkdir(parents=True, exist_ok=True)
    payload = directory/'request.json'
    project = directory/'workspace/Stress.pls'
    if rows:
        make_payload(payload, rows, project, bootstrap)
    executable = str(app/'Contents/MacOS/app')
    before = set(processes())
    home = directory/'home'
    home.mkdir(exist_ok=True)
    subprocess.run(['open', '-n', '-g', '--env', f'HOME={home}', str(app)], check=True)
    root = None
    for _ in range(100):
        table = processes()
        roots = [pid for pid, (_, command) in table.items()
                 if pid not in before and command == executable]
        if roots:
            root = roots[0]
            break
        time.sleep(.1)
    if root is None:
        raise RuntimeError('Release app did not launch')
    monitor = Monitor(root, directory/'samples.csv')
    outcome = dict(name=name, cpu_clock_conversion_factor=CLOCK_NS_PER_TICK,
                   rows=rows, variables=100 if rows else 0,
                   constructs=20 if rows else 0, requested_bootstrap_samples=10000 if bootstrap else 0)
    backend = None
    started = time.monotonic()
    try:
        for _ in range(100):
            table = processes()
            backends = [pid for pid, (parent, command) in table.items()
                        if parent == root and 'statsem-backend' in command]
            if backends:
                backend = backends[0]
                sockets = subprocess.run(['lsof', '-Pan', '-p', str(backend), '-iTCP',
                                          '-sTCP:LISTEN', '-Fn'], capture_output=True, text=True).stdout
                listeners = [line for line in sockets.splitlines() if line.startswith('n127.0.0.1:')]
                if listeners:
                    port = int(listeners[0].rsplit(':', 1)[1])
                    break
            time.sleep(.1)
        else:
            raise RuntimeError('Bundled sidecar did not listen')
        time.sleep(3)
        monitor.phase = 'idle'
        time.sleep(15 if not rows else 3)
        if not rows:
            outcome['status'] = 'completed'
            return
        request(port, '/workspace/create', dict(folder_path=str(directory/'workspace'), name='Stress'))
        request(port, '/workspace/add-project', dict(folder_path=str(directory/'workspace'), project_name='Stress'))
        monitor.phase = 'bootstrap' if bootstrap else 'pls'
        started = time.monotonic()
        result = request(port, '/project/bootstrap-start' if bootstrap else '/project/run-pls', payload=payload)
        if bootstrap:
            job = result['job_id']
            observations = []
            while time.monotonic()-started < duration and not monitor.abort_reason:
                state = request(port, '/project/bootstrap-status?job_id='+job)
                observations.append(dict(seconds=time.monotonic()-started, current=state['current'],
                                         total=state['total'], status=state['status']))
                print(name, observations[-1], flush=True)
                if state['status'] != 'running':
                    outcome['status'] = state['status']
                    break
                time.sleep(2)
            else:
                outcome['status'] = 'memory_limited' if monitor.abort_reason else 'time_limited'
                if not monitor.abort_reason:
                    request(port, '/project/bootstrap-cancel?job_id='+job, {})
                    time.sleep(3)
            outcome['progress'] = observations
        else:
            outcome['status'] = result.get('status', 'completed')
            outcome['response_bytes_approx'] = len(json.dumps(result))
        outcome['workload_seconds'] = time.monotonic()-started
        monitor.phase = 'after_workload'
        time.sleep(3)
    except Exception as error:
        outcome['status'] = 'memory_limited' if monitor.abort_reason else 'failed'
        outcome['error'] = str(error)
        outcome['workload_seconds'] = time.monotonic()-started
    finally:
        outcome.update(monitor.finish())
        outcome['backend_pid'] = backend
        if backend:
            terminate(backend)
        terminate(root)
        # Only this app's attributed XPC helpers, never other open apps.
        for pid, command in monitor.members.items():
            if 'com.apple.WebKit.' in command:
                terminate(pid)
        (directory/'summary.json').write_text(json.dumps(outcome, indent=2)+'\n')
        print(json.dumps(outcome, indent=2), flush=True)


if __name__ == '__main__':
    app, output = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    cases = dict(idle=(0, False, 0), pls_1000=(1000, False, 0),
                 pls_10000=(10000, False, 0), pls_50000=(50000, False, 0),
                 bootstrap_1000=(1000, True, 45), bootstrap_50000=(50000, True, 45),
                 bootstrap_complete=(500, True, 240),
                 target_500000=(500000, True, 45))
    selected = sys.argv[3:] or list(cases)
    for case in selected:
        run(app, output, case, *cases[case])
