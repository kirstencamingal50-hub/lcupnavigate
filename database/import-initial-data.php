<?php
declare(strict_types=1);
require __DIR__ . '/../api/bootstrap.php';

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$file = __DIR__ . '/initial-data.json';
if (!is_file($file)) { fwrite(STDERR, "Seed file not found. Run: node database/build-initial-data.mjs\n"); exit(1); }
$seed = json_decode((string)file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
$pdo = db();
$pdo->beginTransaction();
try {
    $categoryIds = [];
    foreach ($pdo->query('SELECT id, name FROM categories') as $row) $categoryIds[$row['name']] = (int)$row['id'];
    $find = $pdo->prepare('SELECT id FROM locations WHERE BINARY name = BINARY ? LIMIT 1');
    $makeRoomBuilding = $pdo->prepare("UPDATE locations SET kind='building' WHERE id=? AND verified=0");
    $insert = $pdo->prepare('INSERT INTO locations (name,kind,description,category_id,verified) VALUES (?,?,?,?,0)');
    $locationIds = [];
    foreach ($seed['locations'] as $location) {
        $find->execute([$location['name']]); $existing = $find->fetchColumn();
        if ($existing) {
            $locationIds[$location['name']] = (int)$existing;
            if (in_array($location['name'], array_column($seed['rooms'], 'building_name'), true)) $makeRoomBuilding->execute([(int)$existing]);
            continue;
        }
        $insert->execute([$location['name'], $location['kind'], $location['description'], $categoryIds[$location['category']] ?? null]);
        $locationIds[$location['name']] = (int)$pdo->lastInsertId();
    }
    $roomBuilding = $pdo->prepare('SELECT id FROM locations WHERE BINARY name=BINARY ? AND kind=\'building\' AND active=1 LIMIT 1');
    $findRoom = $pdo->prepare('SELECT id FROM rooms WHERE building_id=? AND room_number=? AND floor_number=0 LIMIT 1');
    $insertRoom = $pdo->prepare('INSERT INTO rooms (building_id,name,room_number,floor_number,floor_label,capacity,description,verified) VALUES (?,?,?,0,?,?,?,0)');
    foreach ($seed['rooms'] as $room) {
        $roomBuilding->execute([$room['building_name']]); $buildingId=$roomBuilding->fetchColumn(); if(!$buildingId) continue;
        $findRoom->execute([$buildingId,$room['room_number']]); if($findRoom->fetchColumn()) continue;
        $insertRoom->execute([$buildingId,$room['name'],$room['room_number'],$room['floor_label'],$room['capacity'],$room['description']]);
    }
    $nodeIds = [];
    $findNode = $pdo->prepare('SELECT id FROM map_nodes WHERE node_key=?');
    $insertNode = $pdo->prepare('INSERT INTO map_nodes (node_key,x,y,floor_number,verified) VALUES (?,?,?,0,0)');
    foreach ($seed['nodes'] as $node) {
        $findNode->execute([$node['node_key']]); $found = $findNode->fetchColumn();
        if ($found) { $nodeIds[$node['node_key']] = (int)$found; continue; }
        $insertNode->execute([$node['node_key'], $node['x'], $node['y']]); $nodeIds[$node['node_key']] = (int)$pdo->lastInsertId();
    }
    $findMarker = $pdo->prepare('SELECT id FROM map_markers WHERE location_id=? AND map_key=? LIMIT 1');
    $insertMarker = $pdo->prepare('INSERT INTO map_markers (location_id,x,y,floor_number,map_key,verified) VALUES (?,?,?,0,?,0)');
    foreach ($seed['markers'] as $marker) {
        $locId = $locationIds[$marker['location_name']] ?? null; if (!$locId) continue;
        $findMarker->execute([$locId, $marker['map_key']]); if ($findMarker->fetchColumn()) continue;
        $insertMarker->execute([$locId, $marker['x'], $marker['y'], $marker['map_key']]);
    }
    $findEdge = $pdo->prepare('SELECT id FROM map_connections WHERE from_node_id=? AND to_node_id=? LIMIT 1');
    $insertEdge = $pdo->prepare('INSERT INTO map_connections (from_node_id,to_node_id,weight,verified,accessibility_status) VALUES (?,?,?,0,NULL)');
    foreach ($seed['connections'] as $edge) {
        $from=$nodeIds[$edge['from_node_key']]??null; $to=$nodeIds[$edge['to_node_key']]??null;
        if (!$from || !$to) continue;
        $findEdge->execute([$from,$to]); if ($findEdge->fetchColumn()) continue;
        $insertEdge->execute([$from,$to,$edge['weight']]);
    }
    $pdo->commit();
    fwrite(STDOUT, 'Imported review-pending seed data: ' . count($locationIds) . " locations, " . count($seed['markers']) . " map markers, " . count($nodeIds) . " nodes, " . count($seed['connections']) . " unverified connections.\n");
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    fwrite(STDERR, "Import failed: {$e->getMessage()}\n"); exit(1);
}
