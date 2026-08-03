/**
 * PSD 编辑器节点树 UI — 对齐 aiws (ai-game-workspace) layout-tree：
 * 扁平行 + padding-left 缩进 + twist 折叠 + pointer 拖拽（before/after/into）
 */
(function (global) {
  'use strict';

  var INDENT = 14;
  var PAD_BASE = 8;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function expandKey(n) {
    if (!n) return '';
    return String(n.id || n.path || n.name || '');
  }

  function nodesSame(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id) return a.id === b.id;
    if (a.type === 'leaf' && b.type === 'leaf') return a.tileIndex === b.tileIndex;
    return a.path && b.path && a.path === b.path;
  }

  function walkFind(root, pred, parent) {
    var kids = (root && root.children) || [];
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (pred(n, root, i)) return { node: n, parent: root, index: i };
      var hit = walkFind(n, pred, root);
      if (hit) return hit;
    }
    return null;
  }

  function findById(root, id) {
    if (!id) return null;
    if (root.id === id) return { node: root, parent: null, index: -1 };
    return walkFind(root, function (n) {
      return n.id === id;
    });
  }

  function isDescendant(root, ancestor, maybeChild) {
    if (!ancestor || !maybeChild) return false;
    var hit = false;
    function walk(n) {
      if (nodesSame(n, maybeChild)) {
        hit = true;
        return;
      }
      (n.children || []).forEach(walk);
    }
    (ancestor.children || []).forEach(walk);
    return hit;
  }

  function removeNode(root, node) {
    var loc = walkFind(root, function (n) {
      return nodesSame(n, node);
    });
    if (!loc || !loc.parent) return null;
    loc.parent.children.splice(loc.index, 1);
    return loc;
  }

  function insertChild(parent, node, index) {
    if (!parent.children) parent.children = [];
    var i = index == null ? parent.children.length : index;
    if (i < 0) i = 0;
    if (i > parent.children.length) i = parent.children.length;
    parent.children.splice(i, 0, node);
  }

  function cloneTree(n) {
    return {
      type: n.type,
      id: n.id,
      name: n.name,
      path: n.path,
      tileIndex: n.tileIndex,
      children: (n.children || []).map(cloneTree),
    };
  }

  /**
   * 从 tiles[].path 建可变树
   */
  function buildFromTiles(tiles, tileKeyFn) {
    var root = { type: 'root', id: 'root', name: '', path: '', children: [] };

    function ensureFolder(parent, name, path) {
      for (var i = 0; i < parent.children.length; i++) {
        var c = parent.children[i];
        if (c.type === 'group' && c.name === name) return c;
      }
      var g = {
        type: 'group',
        id: 'g:' + path,
        name: name,
        path: path,
        children: [],
      };
      parent.children.push(g);
      return g;
    }

    (tiles || []).forEach(function (t, i) {
      if (!t || !t.file) return;
      var parts = String(t.path || '(unnamed)')
        .split('/')
        .map(function (x) {
          return x.trim();
        })
        .filter(Boolean);
      if (!parts.length) parts = ['(unnamed)'];
      var parent = root;
      var acc = '';
      for (var d = 0; d < parts.length - 1; d++) {
        acc = acc ? acc + '/' + parts[d] : parts[d];
        parent = ensureFolder(parent, parts[d], acc);
      }
      parent.children.push({
        type: 'leaf',
        id: tileKeyFn(t, i),
        name: parts[parts.length - 1],
        path: t.path,
        tileIndex: i,
        children: [],
      });
    });
    return root;
  }

  function createController(opts) {
    var rootEl = opts.rootEl;
    var treeData = null;
    var expanded = new Set();
    var skipClickOnce = false;
    var ptrDrag = null;
    var dragState = null;
    var scrollStep = 0;
    var scrollRaf = 0;

    function seedExpand(n, depth) {
      if (!n) return;
      var key = expandKey(n);
      if (key && n.type === 'group' && depth <= 2) expanded.add(key);
      (n.children || []).forEach(function (c) {
        seedExpand(c, depth + 1);
      });
    }

    function clearDropIndicators() {
      rootEl.querySelectorAll('.drop-before, .drop-after, .drop-into, .layout-dragging').forEach(function (el) {
        el.classList.remove('drop-before', 'drop-after', 'drop-into', 'layout-dragging');
      });
    }

    function stopAutoScroll() {
      scrollStep = 0;
      if (scrollRaf) {
        cancelAnimationFrame(scrollRaf);
        scrollRaf = 0;
      }
    }

    function endDragSession() {
      ptrDrag = null;
      dragState = null;
      stopAutoScroll();
      clearDropIndicators();
      rootEl.classList.remove('layout-tree-dragging');
    }

    function itemFromPoint(x, y) {
      var el = document.elementFromPoint(x, y);
      return (el && el.closest && el.closest('.layout-tree-item')) || null;
    }

    function tickScroll() {
      scrollRaf = 0;
      if (!dragState || !scrollStep) return;
      var prev = rootEl.scrollTop;
      rootEl.scrollTop = prev + scrollStep;
      if (rootEl.scrollTop === prev) return;
      scrollRaf = requestAnimationFrame(tickScroll);
    }

    function updateAutoScroll(clientY) {
      if (!dragState) {
        stopAutoScroll();
        return;
      }
      var rect = rootEl.getBoundingClientRect();
      var edge = 40;
      var step = 0;
      if (clientY < rect.top + edge) {
        var dist = rect.top + edge - clientY;
        var t = Math.min(1, dist / Math.max(edge, 1));
        step = -Math.ceil(6 + t * 22);
      } else if (clientY > rect.bottom - edge) {
        var dist2 = clientY - (rect.bottom - edge);
        var t2 = Math.min(1, dist2 / Math.max(edge, 1));
        step = Math.ceil(6 + t2 * 22);
      }
      if (!step) {
        stopAutoScroll();
        return;
      }
      scrollStep = step;
      if (!scrollRaf) scrollRaf = requestAnimationFrame(tickScroll);
    }

    function canDropInto(moving, target) {
      if (!moving || !target || nodesSame(moving, target)) return false;
      if (target.type !== 'group' && target.type !== 'root') return false;
      if (moving.type === 'group' && isDescendant(treeData, moving, target)) return false;
      if (nodesSame(moving, target)) return false;
      return true;
    }

    function canDropBeside(moving, target) {
      if (!moving || !target || nodesSame(moving, target)) return false;
      if (target.type === 'root') return false;
      return true;
    }

    function resolveDropZone(ev, itemEl, moving, target) {
      var rect = itemEl.getBoundingClientRect();
      var ratio = rect.height > 0 ? (ev.clientY - rect.top) / rect.height : 0.5;
      var intoOk = canDropInto(moving, target);
      var besideOk = canDropBeside(moving, target);
      var hasKids = (target.children || []).length > 0;
      var edge = intoOk && !hasKids ? 0.12 : intoOk ? 0.22 : 0.28;
      if (ratio < edge) return besideOk ? 'before' : intoOk ? 'into' : null;
      if (ratio > 1 - edge) return besideOk ? 'after' : intoOk ? 'into' : null;
      if (intoOk) return 'into';
      if (besideOk) return ratio < 0.5 ? 'before' : 'after';
      return null;
    }

    function updateDragHover(ev) {
      if (!dragState) return;
      updateAutoScroll(ev.clientY);
      clearDropIndicators();
      var dragEl = null;
      try {
        dragEl = rootEl.querySelector('.layout-tree-item[data-id="' + CSS.escape(dragState.id) + '"]');
      } catch (e) {
        dragEl = rootEl.querySelector('.layout-tree-item[data-id="' + dragState.id.replace(/"/g, '\\"') + '"]');
      }
      if (dragEl) dragEl.classList.add('layout-dragging');
      var item = itemFromPoint(ev.clientX, ev.clientY);
      if (!item) return;
      var targetLoc = findById(treeData, item.dataset.id);
      var movingLoc = findById(treeData, dragState.id);
      if (!targetLoc || !movingLoc) return;
      var zone = resolveDropZone(ev, item, movingLoc.node, targetLoc.node);
      if (!zone) return;
      item.classList.add(zone === 'into' ? 'drop-into' : zone === 'before' ? 'drop-before' : 'drop-after');
    }

    function parentOfTarget(targetLoc) {
      return targetLoc.parent || treeData;
    }

    function applyDrop(movingId, targetId, zone) {
      var movingLoc = findById(treeData, movingId);
      var targetLoc = findById(treeData, targetId);
      if (!movingLoc || !targetLoc || !zone) return false;
      var moving = movingLoc.node;
      var target = targetLoc.node;
      if (zone === 'into') {
        if (!canDropInto(moving, target)) return false;
        removeNode(treeData, moving);
        insertChild(target, moving, target.children.length);
        expanded.add(expandKey(target));
      } else {
        if (!canDropBeside(moving, target)) return false;
        var parent = parentOfTarget(targetLoc);
        var fromSame = movingLoc.parent === parent;
        var fromIndex = movingLoc.index;
        removeNode(treeData, moving);
        var targetIndex = parent.children.indexOf(target);
        if (targetIndex < 0) return false;
        var place = zone === 'before' ? targetIndex : targetIndex + 1;
        if (fromSame && fromIndex < place) place -= 1;
        insertChild(parent, moving, place);
      }
      if (opts.onTreeMutated) opts.onTreeMutated(treeData);
      render();
      return true;
    }

    function render() {
      if (!treeData) {
        rootEl.innerHTML = '<div class="muted" style="padding:8px">暂无节点树</div>';
        return;
      }
      if (expanded.size === 0) seedExpand(treeData, 0);

      var lines = [];
      function walk(n, depth, parentPath) {
        if (!n || n.type === 'root') {
          (n.children || []).forEach(function (c) {
            walk(c, 0, '');
          });
          return;
        }
        var key = expandKey(n);
        var hasKids = n.type === 'group' && (n.children || []).length > 0;
        var isOpen = hasKids && expanded.has(key);
        var pad = PAD_BASE + depth * INDENT;
        var twist = hasKids ? (isOpen ? '▼' : '▶') : '·';
        var inactive = '';
        if (opts.isNodeInactive && opts.isNodeInactive(n)) inactive = ' inactive-node';
        var active = '';
        if (opts.isNodeActive && opts.isNodeActive(n)) active = ' active';
        var eyeChecked = opts.isEyeChecked ? opts.isEyeChecked(n) : true;
        var name = opts.displayName ? opts.displayName(n) : n.name;
        var tileAttr =
          n.type === 'leaf' && n.tileIndex != null ? ' data-tile-index="' + n.tileIndex + '"' : '';
        var groupAttr = n.type === 'group' && n.path ? ' data-group-path="' + escapeHtml(n.path) + '"' : '';

        lines.push(
          '<div class="layout-tree-item layout-tree-draggable' +
            inactive +
            active +
            '" data-id="' +
            escapeHtml(n.id) +
            '" data-kind="' +
            n.type +
            '"' +
            tileAttr +
            groupAttr +
            ' style="padding-left:' +
            pad +
            'px" title="按住拖拽：中间=改挂 · 上下边缘=调序">' +
            '<span class="layout-tree-twist" data-twist="' +
            escapeHtml(key) +
            '">' +
            twist +
            '</span>' +
            '<input type="checkbox" class="layout-vis" title="可见" ' +
            (eyeChecked ? 'checked' : '') +
            ' />' +
            '<span class="layout-tree-name">' +
            escapeHtml(name) +
            '</span>' +
            (n.type === 'leaf' && n.tileIndex != null
              ? '<span class="layout-tree-badge">#' + n.tileIndex + '</span>'
              : '') +
            '</div>',
        );

        if (hasKids && isOpen) {
          (n.children || []).forEach(function (c) {
            walk(c, depth + 1, n.path || parentPath);
          });
        }
      }
      walk(treeData, 0, '');
      rootEl.innerHTML = lines.join('') || '<div class="muted" style="padding:8px">空树</div>';
    }

    function syncEyes() {
      rootEl.querySelectorAll('.layout-tree-item').forEach(function (el) {
        var id = el.dataset.id;
        var loc = findById(treeData, id);
        if (!loc) return;
        var n = loc.node;
        var cb = el.querySelector('.layout-vis');
        if (cb && opts.isEyeChecked) cb.checked = !!opts.isEyeChecked(n);
        if (opts.isNodeInactive) {
          el.classList.toggle('inactive-node', !!opts.isNodeInactive(n));
        }
        var nameEl = el.querySelector('.layout-tree-name');
        if (nameEl && opts.displayName) nameEl.textContent = opts.displayName(n);
      });
    }

    function highlightLeaf(tileIndex) {
      if (tileIndex == null) {
        rootEl.querySelectorAll('.layout-tree-item.active').forEach(function (el) {
          el.classList.remove('active');
        });
        return;
      }
      function expandTo(n, trail) {
        if (!n) return false;
        if (n.type === 'leaf' && n.tileIndex === tileIndex) {
          trail.forEach(function (g) {
            expanded.add(expandKey(g));
          });
          return true;
        }
        var next = trail;
        if (n.type === 'group') next = trail.concat([n]);
        var kids = n.children || [];
        for (var i = 0; i < kids.length; i++) {
          if (expandTo(kids[i], next)) return true;
        }
        return false;
      }
      expandTo(treeData, []);
      render();
      var row = rootEl.querySelector('.layout-tree-item[data-tile-index="' + tileIndex + '"]');
      if (row) {
        row.classList.add('active');
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    rootEl.addEventListener('click', function (ev) {
      if (skipClickOnce) {
        skipClickOnce = false;
        ev.preventDefault();
        return;
      }
      var twist = ev.target.closest && ev.target.closest('[data-twist]');
      if (twist) {
        ev.preventDefault();
        ev.stopPropagation();
        var k = twist.getAttribute('data-twist');
        if (expanded.has(k)) expanded.delete(k);
        else expanded.add(k);
        render();
        return;
      }
      if (ev.target.closest && ev.target.closest('.layout-vis')) return;
      var item = ev.target.closest && ev.target.closest('.layout-tree-item');
      if (!item) return;
      var loc = findById(treeData, item.dataset.id);
      if (!loc) return;
      if (opts.onSelect) opts.onSelect(loc.node);
    });

    rootEl.addEventListener('change', function (ev) {
      var cb = ev.target;
      if (!cb || !cb.classList || !cb.classList.contains('layout-vis')) return;
      var item = cb.closest('.layout-tree-item');
      if (!item) return;
      var loc = findById(treeData, item.dataset.id);
      if (!loc) return;
      if (opts.onToggleEye) opts.onToggleEye(loc.node, cb.checked);
    });

    rootEl.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      if (ev.target.closest && ev.target.closest('.layout-vis, [data-twist]')) return;
      var item = ev.target.closest && ev.target.closest('.layout-tree-item');
      if (!item || !item.classList.contains('layout-tree-draggable')) return;
      ptrDrag = {
        id: item.dataset.id,
        startX: ev.clientX,
        startY: ev.clientY,
        active: false,
        pointerId: ev.pointerId,
      };
    });

    document.addEventListener('pointermove', function (ev) {
      if (!ptrDrag || ev.pointerId !== ptrDrag.pointerId) return;
      var dx = ev.clientX - ptrDrag.startX;
      var dy = ev.clientY - ptrDrag.startY;
      if (!ptrDrag.active) {
        if (dx * dx + dy * dy < 36) return;
        ptrDrag.active = true;
        dragState = { id: ptrDrag.id };
        rootEl.classList.add('layout-tree-dragging');
        try {
          rootEl.setPointerCapture(ev.pointerId);
        } catch (e) {}
        if (opts.onDragStatus) opts.onDragStatus('拖拽中 · 中间=改挂，上下边=调序');
      }
      ev.preventDefault();
      updateDragHover(ev);
    });

    document.addEventListener('pointerup', function (ev) {
      if (!ptrDrag || ev.pointerId !== ptrDrag.pointerId) return;
      var wasActive = ptrDrag.active;
      var movingId = ptrDrag.id;
      var zone = null;
      var targetId = null;
      if (wasActive) {
        skipClickOnce = true;
        var item = itemFromPoint(ev.clientX, ev.clientY);
        if (item) {
          targetId = item.dataset.id;
          var movingLoc = findById(treeData, movingId);
          var targetLoc = findById(treeData, targetId);
          if (movingLoc && targetLoc) {
            zone = resolveDropZone(ev, item, movingLoc.node, targetLoc.node);
          }
        }
      }
      try {
        rootEl.releasePointerCapture(ev.pointerId);
      } catch (e2) {}
      endDragSession();
      if (wasActive && movingId && targetId && zone) {
        applyDrop(movingId, targetId, zone);
        if (opts.onDragStatus) opts.onDragStatus('未保存 · 树结构已改');
      }
    });

    document.addEventListener('pointercancel', function (ev) {
      if (!ptrDrag || ev.pointerId !== ptrDrag.pointerId) return;
      endDragSession();
    });

    return {
      setTree: function (tree, keepExpand) {
        treeData = tree;
        if (!keepExpand) {
          expanded = new Set();
          seedExpand(treeData, 0);
        }
        render();
      },
      getTree: function () {
        return treeData;
      },
      getSnapshot: function () {
        return treeData ? cloneTree(treeData) : null;
      },
      render: render,
      syncEyes: syncEyes,
      highlightLeaf: highlightLeaf,
      buildFromTiles: buildFromTiles,
    };
  }

  global.PsdTreeUi = {
    create: createController,
    buildFromTiles: buildFromTiles,
    expandKey: expandKey,
    findById: findById,
    cloneTree: cloneTree,
  };
})(window);
