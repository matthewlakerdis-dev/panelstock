import {requireCondition as check} from './security.js';

function activePositions(sql) {
  return sql.exec(`
    SELECT u.username AS id, COALESCE(NULLIF(u.display_name, ''), u.username) AS name,
           u.title, NULLIF(json_extract(p.data, '$.supervisorUsername'), '') AS managerId
    FROM access_users u LEFT JOIN employee_profiles p ON p.username = u.username
    WHERE u.active = 1
    ORDER BY name COLLATE NOCASE, u.username
  `).toArray();
}

export function checkSupervisorChain(sql, username, supervisor) {
  if (!supervisor) return;
  // Include inactive accounts: a reporting loop can pass through an inactive supervisor.
  const rows = sql.exec("SELECT username, json_extract(data, '$.supervisorUsername') AS supervisor FROM employee_profiles").toArray();
  const supervisors = new Map(rows.map(row => [row.username, row.supervisor]));
  const seen = new Set([username]);
  for (let current = supervisor; current; current = supervisors.get(current)) {
    check(!seen.has(current), 'This reporting line would form a loop. Choose another supervisor.');
    seen.add(current);
  }
}

export function checkPreviousReporting(title, managerId, previous) {
  check(typeof previous?.title === 'string' && (previous.managerId === null || typeof previous.managerId === 'string'),
    'The previous title and supervisor are required');
  check(title === previous.title && managerId === previous.managerId,
    'This employee’s title or supervisor has changed. Reload the page and reopen this employee before saving.', 409);
}

export function handleOrgChart(store, method, body, actor) {
  check(actor.isAdmin, 'Administrator access required', 403);
  if (method === 'GET') {
    return {status:200, body:{positions:activePositions(store.sql)}};
  }

  check(method === 'POST', 'Method not allowed', 405);
  const {id, managerId, previous} = body;
  check(typeof id === 'string' && id.length > 0, 'Choose a staff member');
  check(typeof body.title === 'string' && body.title.trim().length <= 100, 'Enter a job title of up to 100 characters');
  check(managerId === null || (typeof managerId === 'string' && managerId.length > 0), 'Choose a supervisor');
  const title = body.title.trim();
  store.ctx.storage.transactionSync(() => {
    const staff = activePositions(store.sql);
    const employee = staff.find(person => person.id === id);
    check(employee, 'Active staff member not found', 404);
    checkPreviousReporting(employee.title, employee.managerId, previous);
    const managerChanged = managerId !== employee.managerId;
    if (managerChanged) {
      check(managerId === null || staff.some(person => person.id === managerId), 'Choose an active supervisor');
      checkSupervisorChain(store.sql, id, managerId);
    }
    if (employee.title === title && !managerChanged) return;
    const now = new Date().toISOString();
    if (employee.title !== title) {
      const users = store.read('users', {});
      check(Object.hasOwn(users, id), 'Active staff member not found', 404);
      users[id] = {...users[id], title, updatedAt:now};
      store.write('users', users);
      store.sql.exec('UPDATE access_users SET title = ?, updated_at = ? WHERE username = ?', title, now, id);
    }
    if (managerChanged) {
      store.sql.exec(`
        INSERT INTO employee_profiles (username, data, updated_at) VALUES (?, json_object('supervisorUsername', ?), ?)
        ON CONFLICT(username) DO UPDATE SET
          data = json_set(employee_profiles.data, '$.supervisorUsername', ?), updated_at = excluded.updated_at
      `, id, managerId || '', now, managerId || '');
    }
    store.audit(actor.username, 'org-chart-updated', {target:id, title, supervisorUsername:managerId});
  });
  return {status:200, body:{positions:activePositions(store.sql)}};
}
