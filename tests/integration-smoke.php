<?php
declare(strict_types=1);
require __DIR__ . '/../api/bootstrap.php';

const BASE_URL = 'http://127.0.0.1/Capstone/api/index.php';
$pdo = db();
$suffix = bin2hex(random_bytes(5));
$username = 'smoke_' . $suffix;
$prefix = 'Codex smoke ' . $suffix;
$password = bin2hex(random_bytes(16));
$sessionA = tempnam(sys_get_temp_dir(), 'lcup-a-');
$sessionB = tempnam(sys_get_temp_dir(), 'lcup-b-');
$adminId = null;
$createdAdminAccountId = null;
$createdLocationIds = [];
$createdNodeIds = [];
$createdMarkerIds = [];
$createdAnnouncementId = null;
$createdRoomId = null;
$createdRouteId = null;
$passes = [];

function request_api(string $resource, string $method = 'GET', ?array $body = null, ?string $csrf = null, ?string $cookieJar = null): array
{
    $parts = explode('?', $resource, 2);
    parse_str($parts[1] ?? '', $query);
    $query = ['resource' => $parts[0]] + $query;
    $curl = curl_init(BASE_URL . '?' . http_build_query($query));
    $headers = ['Accept: application/json'];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    if ($csrf !== null) $headers[] = 'X-CSRF-Token: ' . $csrf;
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body),
        CURLOPT_COOKIEJAR => $cookieJar,
        CURLOPT_COOKIEFILE => $cookieJar,
        CURLOPT_TIMEOUT => 15,
    ]);
    $raw = curl_exec($curl);
    if ($raw === false) throw new RuntimeException('HTTP request failed: ' . curl_error($curl));
    $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    $json = json_decode($raw, true);
    if (!is_array($json)) throw new RuntimeException("Non-JSON response ({$status}).");
    return [$status, $json];
}

function expect_status(array $response, int $expected, string $label): array
{
    if ($response[0] !== $expected) throw new RuntimeException("{$label}: expected HTTP {$expected}, received {$response[0]}: " . ($response[1]['error']['message'] ?? ''));
    return $response[1]['data'] ?? [];
}

function pass(string $label): void
{
    global $passes;
    $passes[] = $label;
}

try {
    $freshEntry = expect_status(request_api('auth/entry', 'GET', null, null, $sessionB), 200, 'Fresh entry state');
    if (($freshEntry['role'] ?? null) !== null) throw new RuntimeException('A fresh browser session unexpectedly retained a role.');
    expect_status(request_api('auth/entry', 'POST', ['role'=>'visitor'], null, $sessionB), 200, 'Select visitor role');
    $continuedEntry = expect_status(request_api('auth/entry', 'GET', null, null, $sessionB), 200, 'Persisted entry state');
    if (($continuedEntry['role'] ?? null) !== 'visitor') throw new RuntimeException('Visitor role did not persist in the server session.');
    expect_status(request_api('admin/overview', 'GET', null, null, $sessionB), 401, 'Visitor admin access');
    expect_status(request_api('admin/accounts', 'GET', null, null, $sessionB), 401, 'Visitor account management access');
    pass('Visitor role persists in server session without administrator access');

    $unauthorized = request_api('locations', 'POST', ['name' => 'Unauthorized test']);
    expect_status($unauthorized, 401, 'Unauthenticated admin write');
    pass('Unauthenticated administrative write rejected');
    expect_status(request_api('routes'),401,'Unauthenticated saved route list');
    pass('Saved route management is server-side administrator protected');

    [$csrfStatus, $csrfResponse] = request_api('auth/csrf', 'GET', null, null, $sessionA);
    $csrf = expect_status([$csrfStatus, $csrfResponse], 200, 'CSRF bootstrap')['token'];
    $pdo->prepare('INSERT INTO admin_users (username,password_hash,role) VALUES (?,?,\'admin\')')->execute([$username, password_hash($password, PASSWORD_DEFAULT)]);
    $adminId = (int)$pdo->lastInsertId();
    $loginStatus=expect_status(request_api('auth/login-status'),200,'Saved admin account status');
    if (($loginStatus['configured']??false)!==true) throw new RuntimeException('A saved active administrator account was not reported as configured.');
    $invalid = request_api('auth/login', 'POST', ['username' => $username, 'password' => 'incorrect'], $csrf, $sessionA);
    expect_status($invalid, 401, 'Invalid credentials');
    pass('Invalid administrator credentials rejected');
    $login = expect_status(request_api('auth/login', 'POST', ['username' => $username, 'password' => $password], $csrf, $sessionA), 200, 'Valid login');
    $csrf = $login['csrf'];
    if (($login['user']['role'] ?? '') !== 'admin') throw new RuntimeException('Login returned the wrong role.');
    pass('Password hash authentication and session login');

    $savedPassword='T3st!AccountPass-2026';
    $pdo->prepare('INSERT INTO admin_users (full_name,username,email,password_hash,role) VALUES (?,?,?,?,?)')->execute([$prefix.' Manager',$username.'.extra',$username.'@example.test',password_hash($savedPassword,PASSWORD_DEFAULT),'editor']);
    $createdAdminAccountId=(int)$pdo->lastInsertId();
    $editorCsrf=expect_status(request_api('auth/csrf','GET',null,null,$sessionB),200,'Editor CSRF bootstrap')['token'];
    expect_status(request_api('auth/login','POST',['username'=>$username.'@example.test','password'=>$savedPassword],$editorCsrf,$sessionB),200,'Email login');
    expect_status(request_api('admin/accounts','GET',null,null,$sessionB),403,'Editor account management access');
    expect_status(request_api('admin/accounts','POST',['full_name'=>'Forbidden Create','username'=>$username.'.new','email'=>$username.'.new@example.test','password'=>$savedPassword,'role'=>'editor'],$csrf,$sessionA),405,'Disable account creation endpoint');
    expect_status(request_api('admin/accounts','PUT',['id'=>$adminId,'role'=>'admin','active'=>false],$csrf,$sessionA),409,'Self disable protection');
    expect_status(request_api('admin/accounts','PUT',['id'=>$createdAdminAccountId,'role'=>'viewer','active'=>false],$csrf,$sessionA),200,'Disable managed account');
    expect_status(request_api('admin/overview','GET',null,null,$sessionB),401,'Disabled account session revocation');
    $adminAccounts=expect_status(request_api('admin/accounts','GET',null,null,$sessionA),200,'List admin accounts');
    if(!array_filter($adminAccounts,fn($account)=>(int)$account['id']===$createdAdminAccountId&&(int)$account['active']===0&&$account['role']==='viewer'))throw new RuntimeException('Administrator account status or role was not persisted.');
    pass('Saved account password hashes authenticate; creation endpoint is disabled; account status management remains protected');
    pass('Editor role cannot access administrator account management');
    pass('Administrator login accepts the account email');

    expect_status(request_api('auth/profile','PUT',['full_name'=>$prefix.' Primary','username'=>$username,'email'=>$username.'@primary.example.test'],$csrf,$sessionA),200,'Update administrator profile');
    $profile=expect_status(request_api('auth/profile','GET',null,null,$sessionA),200,'Read administrator profile');
    if($profile['full_name']!==$prefix.' Primary'||$profile['email']!==$username.'@primary.example.test')throw new RuntimeException('Administrator profile did not persist.');
    expect_status(request_api('auth/password','POST',['current_password'=>'wrong','password'=>'An0ther!SecurePass-2026'],$csrf,$sessionA),403,'Reject incorrect current password');
    expect_status(request_api('auth/password','POST',['current_password'=>$password,'password'=>'weak'],$csrf,$sessionA),400,'Reject weak password change');
    expect_status(request_api('auth/password','POST',['current_password'=>$password,'password'=>'An0ther!SecurePass-2026'],$csrf,$sessionA),200,'Change password');
    pass('Admin profile persistence and current-password-verified password change');

    $system=expect_status(request_api('admin/system','GET',null,null,$sessionA),200,'Read system information');
    if(($system['database']??'')!=='Connected'||isset($system['credentials'])||isset($system['password']))throw new RuntimeException('System information is incomplete or exposes sensitive data.');
    pass('Authorized system status without database credentials');

    expect_status(request_api('admin/overview', 'GET', null, null, $sessionA), 200, 'Authenticated dashboard');
    pass('Authenticated dashboard endpoint');

    $categoryRows = expect_status(request_api('categories'), 200, 'Public categories');
    $directory = expect_status(request_api('directory'), 200, 'Public directory');
    $storedMap = expect_status(request_api('map'), 200, 'Public map');
    $publicAnnouncements = expect_status(request_api('announcements'), 200, 'Public announcements');
    if (count($categoryRows) !== 7 || !is_array($directory['locations']) || !$directory['locations'] || !is_array($directory['rooms']) || !is_array($storedMap['markers']) || !is_array($publicAnnouncements)) throw new RuntimeException('Public bootstrap data was incomplete.');
    pass('Public categories, directory, map, and announcement reads');

    $longDetails=trim(str_repeat($prefix.' complete saved details for the campus location. ',50));
    $building = expect_status(request_api('locations', 'POST', ['name'=>$prefix.' Building','kind'=>'building','category'=>'Academic','floor_count'=>2,'building_number'=>'BLDG-LONG-2026','capacity'=>240,'description'=>$longDetails,'department_name'=>'Student Services','contact_email'=>'longbuilding@example.test','contact_phone'=>'+63 44 123 4567','website_url'=>'https://example.test/campus/building-information','service_hours'=>'Monday through Friday, 8:00 AM to 5:00 PM','access_hours'=>'Monday through Saturday, 7:00 AM to 8:00 PM','days_open'=>'Monday through Saturday','lunch_break'=>'12:00 PM to 1:00 PM','services'=>$longDetails,'nearby_landmarks'=>'Library, main gate, and student center','accessibility_status'=>1,'accessibility_details'=>'Step-free access at the east entrance.','accessibility_features'=>['wheelchair_entrance','elevator']], $csrf, $sessionA), 201, 'Create test building');
    $buildingId = (int)$building['id']; $createdLocationIds[]=$buildingId;
    expect_status(request_api('locations','PUT',['id'=>$buildingId,'name'=>$prefix.' Building','kind'=>'building','category'=>'Academic','floor_count'=>2,'building_number'=>'BLDG-LONG-2026','capacity'=>240,'description'=>$longDetails,'department_name'=>'Student Services','contact_email'=>'longbuilding@example.test','contact_phone'=>'+63 44 123 4567','website_url'=>'https://example.test/campus/building-information','service_hours'=>'Monday through Friday, 8:00 AM to 5:00 PM','access_hours'=>'Monday through Saturday, 7:00 AM to 8:00 PM','days_open'=>'Monday through Saturday','lunch_break'=>'12:00 PM to 1:00 PM','services'=>$longDetails,'nearby_landmarks'=>'Library, main gate, and student center','accessibility_status'=>1,'accessibility_details'=>'Step-free access at the east entrance.'],$csrf,$sessionA),200,'Update building details while preserving its features');
    $destination = expect_status(request_api('locations', 'POST', ['name'=>$prefix.' Destination','kind'=>'facility','category'=>'Outdoor','parent_building_id'=>$buildingId,'floor_label'=>'Ground Floor','description'=>$longDetails,'department_name'=>'Campus Services','contact_email'=>'facility@example.test','contact_phone'=>'+63 44 765 4321','website_url'=>'https://example.test/facility','service_hours'=>'Weekdays 8 AM–5 PM','access_hours'=>'Monday through Saturday','days_open'=>'Monday through Saturday','lunch_break'=>'12:00 PM to 1:00 PM','services'=>$longDetails,'nearby_landmarks'=>'Main library','accessibility_status'=>1,'accessibility_details'=>'Step-free entrance'], $csrf, $sessionA), 201, 'Create test destination');
    $destinationId=(int)$destination['id'];$createdLocationIds[]=$destinationId;
    expect_status(request_api('locations','POST',['name'=>$prefix.' Invalid Feature Facility','kind'=>'facility','category'=>'Outdoor','accessibility_features'=>['elevator']],$csrf,$sessionA),400,'Reject building features on a facility');
    $facilityDirectory=expect_status(request_api('directory'),200,'Read facility details and gallery');
    $facilityData=array_values(array_filter($facilityDirectory['locations'],fn($item)=>(int)$item['id']===$destinationId))[0]??null;
    $buildingData=array_values(array_filter($facilityDirectory['locations'],fn($item)=>(int)$item['id']===$buildingId))[0]??null;
    $facilityChecks=['row'=>(bool)$facilityData,'parent'=>(int)($facilityData['parentBuildingId']??0)===$buildingId,'floor'=>($facilityData['floorLabel']??null)==='Ground Floor','email'=>($facilityData['contactEmail']??null)==='facility@example.test','phone'=>($facilityData['contactPhone']??null)==='+63 44 765 4321','website'=>($facilityData['websiteUrl']??null)==='https://example.test/facility','accessHours'=>($facilityData['accessHours']??null)==='Monday through Saturday','serviceHours'=>($facilityData['serviceHours']??null)==='Weekdays 8 AM–5 PM','services'=>($facilityData['services']??null)===$longDetails,'description'=>($facilityData['description']??null)===$longDetails,'accessibility'=>(int)($facilityData['accessibilityStatus']??0)===1,'photos'=>isset($facilityData['photos'])&&is_array($facilityData['photos']),'features'=>isset($facilityData['accessibilityFeatures'])&&is_array($facilityData['accessibilityFeatures'])&&$facilityData['accessibilityFeatures']===[]];
    if(in_array(false,$facilityChecks,true))throw new RuntimeException('Facility directory fields failed: '.implode(', ',array_keys(array_filter($facilityChecks,fn($ok)=>!$ok))));
    if(!$buildingData||$buildingData['accessibilityFeatures']!==['wheelchair_entrance','elevator']||$buildingData['description']!==$longDetails||$buildingData['services']!==$longDetails||$buildingData['contactEmail']!=='longbuilding@example.test'||$buildingData['accessHours']!=='Monday through Saturday, 7:00 AM to 8:00 PM'||$buildingData['building_number']!=='BLDG-LONG-2026')throw new RuntimeException('Building details or accessibility features did not persist in the public directory.');
    pass('Complete long building/facility fields, building-only accessibility features, and photo gallery directory shape');
    $startNode=expect_status(request_api('map/nodes','POST',['node_key'=>$prefix.' node 1','x'=>100,'y'=>100],$csrf,$sessionA),201,'Create route node');
    $endNode=expect_status(request_api('map/nodes','POST',['node_key'=>$prefix.' node 2','x'=>110,'y'=>100],$csrf,$sessionA),201,'Create route node');
    $waypointNode=expect_status(request_api('map/nodes','POST',['node_key'=>$prefix.' waypoint','x'=>105,'y'=>105],$csrf,$sessionA),201,'Create route waypoint node');
    $isolatedNode=expect_status(request_api('map/nodes','POST',['node_key'=>$prefix.' isolated','x'=>500,'y'=>500],$csrf,$sessionA),201,'Create isolated node');
    $standaloneNodeA=expect_status(request_api('map/nodes','POST',['node_key'=>$prefix.' standalone a','x'=>600,'y'=>600],$csrf,$sessionA),201,'Create standalone graph node');
    $standaloneNodeB=expect_status(request_api('map/nodes','POST',['node_key'=>$prefix.' standalone b','x'=>610,'y'=>600],$csrf,$sessionA),201,'Create standalone graph node');
    $transitionNode=expect_status(request_api('map/nodes','POST',['node_key'=>$prefix.' upper floor','x'=>620,'y'=>600,'floor_number'=>1],$csrf,$sessionA),201,'Create floor-transition node');
    $createdNodeIds=[(int)$startNode['id'],(int)$endNode['id'],(int)$waypointNode['id'],(int)$isolatedNode['id'],(int)$standaloneNodeA['id'],(int)$standaloneNodeB['id'],(int)$transitionNode['id']];
    $markerStart=expect_status(request_api('map/markers','POST',['location_id'=>$buildingId,'x'=>100,'y'=>100,'accessibility_status'=>1],$csrf,$sessionA),201,'Create route marker without a walkway point');
    $markerEnd=expect_status(request_api('map/markers','POST',['location_id'=>$destinationId,'x'=>110,'y'=>100,'accessibility_status'=>1],$csrf,$sessionA),201,'Create route marker without a walkway point');
    $createdMarkerIds=[(int)$markerStart['id'],(int)$markerEnd['id']];
    $locationVerification=$pdo->prepare('SELECT verified FROM locations WHERE id=?');$locationVerification->execute([$buildingId]);
    if((int)$locationVerification->fetchColumn()!==0)throw new RuntimeException('A location record was unexpectedly marked verified during creation.');
    $pdo->prepare('UPDATE map_markers SET route_node_id=CASE id WHEN ? THEN ? WHEN ? THEN ? END WHERE id IN (?,?)')->execute([$markerStart['id'],$startNode['id'],$markerEnd['id'],$endNode['id'],$markerStart['id'],$markerEnd['id']]);
    $savedRoute=expect_status(request_api('routes','POST',['name'=>$prefix.' Unverified Route','start_marker_id'=>$markerStart['id'],'destination_marker_id'=>$markerEnd['id'],'status'=>'active','notes'=>'Follow the east walkway past the library.','waypoints'=>[['node_id'=>$waypointNode['id'],'notes'=>'Turn toward the student center.']]],$csrf,$sessionA),201,'Publish route with unverified endpoints and no walkway confirmation');
    $createdRouteId=(int)$savedRoute['id'];
    $unverifiedSegments=$pdo->prepare('SELECT COUNT(*) FROM campus_route_segments s JOIN map_connections e ON e.id=s.connection_id WHERE s.route_id=? AND e.verified=0');$unverifiedSegments->execute([$createdRouteId]);
    if((int)$unverifiedSegments->fetchColumn()!==2)throw new RuntimeException('Route publication incorrectly verified newly-created walkway segments.');
    $availableUnverified=expect_status(request_api('routes/available','GET',null,null,$sessionB),200,'Read published route before verification');
    $unverifiedPublicRoute=array_values(array_filter($availableUnverified,fn($route)=>(int)$route['id']===$createdRouteId))[0]??null;
    if(!$unverifiedPublicRoute||(int)$unverifiedPublicRoute['accessible_confirmed']!==0)throw new RuntimeException('Unverified route connections were presented as accessible.');
    $pdo->prepare('UPDATE locations SET verified=1 WHERE id IN (?,?)')->execute([$buildingId,$destinationId]);
    $pdo->prepare('UPDATE map_markers SET verified=1 WHERE id IN (?,?)')->execute([$markerStart['id'],$markerEnd['id']]);
    $pdo->prepare('UPDATE map_connections e JOIN campus_route_segments s ON s.connection_id=e.id SET e.verified=1,e.accessibility_status=1 WHERE s.route_id=?')->execute([$createdRouteId]);
    $routeConnectionQuery=$pdo->prepare('SELECT e.id FROM campus_route_segments s JOIN map_connections e ON e.id=s.connection_id WHERE s.route_id=? ORDER BY s.sequence_no');$routeConnectionQuery->execute([$createdRouteId]);$routeConnectionIds=array_map('intval',$routeConnectionQuery->fetchAll(PDO::FETCH_COLUMN));
    expect_status(request_api('map/connections','POST',['from_node_id'=>$waypointNode['id'],'to_node_id'=>$startNode['id'],'weight'=>10,'connection_type'=>'walkway','verified'=>1,'accessible'=>true,'confirm_walkway'=>true],$csrf,$sessionA),409,'Reject reverse duplicate walkway');
    expect_status(request_api('map/connections','POST',['from_node_id'=>$standaloneNodeA['id'],'to_node_id'=>$standaloneNodeB['id'],'weight'=>10,'connection_type'=>'walkway','verified'=>1,'accessible'=>false,'confirm_walkway'=>true],$csrf,$sessionA),201,'Create verified standalone graph connection');
    expect_status(request_api('map/connections','POST',['from_node_id'=>$standaloneNodeA['id'],'to_node_id'=>$transitionNode['id'],'weight'=>10,'connection_type'=>'walkway'], $csrf,$sessionA),400,'Reject floor change over a walkway');
    $stairs=expect_status(request_api('map/connections','POST',['from_node_id'=>$standaloneNodeA['id'],'to_node_id'=>$transitionNode['id'],'weight'=>10,'connection_type'=>'stairs'],$csrf,$sessionA),201,'Create explicit floor transition');
    $adminMap=expect_status(request_api('map/admin','GET',null,null,$sessionA),200,'Read admin graph connection types');
    if(!array_filter($adminMap['connections'],fn($edge)=>(int)$edge['id']===(int)$stairs['id']&&$edge['connection_type']==='stairs'))throw new RuntimeException('Admin map did not return the saved connection type.');
    $savedRoute=expect_status(request_api('routes','PUT',['id'=>$createdRouteId,'name'=>$prefix.' Visual Route','start_marker_id'=>$markerStart['id'],'destination_marker_id'=>$markerEnd['id'],'status'=>'active','accessibility_status'=>1,'notes'=>'Follow the east walkway past the library.','waypoints'=>[['node_id'=>$waypointNode['id'],'notes'=>'Turn toward the student center.']]],$csrf,$sessionA),200,'Update published route without walkway confirmation');
    expect_status(request_api('map/nodes','DELETE',['id'=>$startNode['id']],$csrf,$sessionA),409,'Protect route-used node from archival');
    expect_status(request_api('map/markers','DELETE',['id'=>$markerStart['id']],$csrf,$sessionA),409,'Protect active route endpoint from archival');
    expect_status(request_api('map/connections','DELETE',['id'=>$routeConnectionIds[0]],$csrf,$sessionA),409,'Protect route-used connection from archival');
    if(($savedRoute['accessibility_status']??null)!==1)throw new RuntimeException('Saved route did not preserve accessibility status.');
    $verifiedPublicRoutes=expect_status(request_api('routes/available'),200,'Read verified accessible route');
    $verifiedPublicRoute=array_values(array_filter($verifiedPublicRoutes,fn($route)=>(int)$route['id']===$createdRouteId))[0]??null;
    if(!$verifiedPublicRoute||(int)$verifiedPublicRoute['accessible_confirmed']!==1||$verifiedPublicRoute['notes']!=='Follow the east walkway past the library.'||$verifiedPublicRoute['points'][1]['notes']!=='Turn toward the student center.')throw new RuntimeException('Verified route access or saved direction notes were not returned completely.');
    $pdo->prepare('UPDATE map_connections SET verified=0 WHERE id=?')->execute([$routeConnectionIds[0]]);
    $revokedAccessibleRoutes=expect_status(request_api('routes/available'),200,'Recheck route accessibility after graph change');
    $revokedAccessibleRoute=array_values(array_filter($revokedAccessibleRoutes,fn($route)=>(int)$route['id']===$createdRouteId))[0]??null;
    if(!$revokedAccessibleRoute||(int)$revokedAccessibleRoute['accessible_confirmed']!==0)throw new RuntimeException('A route still appeared accessible after one of its verified edges was revoked.');
    $pdo->prepare('UPDATE map_connections SET verified=1 WHERE id=?')->execute([$routeConnectionIds[0]]);
    $routeVerification=$pdo->prepare('SELECT verified FROM campus_routes WHERE id=?');$routeVerification->execute([$createdRouteId]);
    if((int)$routeVerification->fetchColumn()!==0)throw new RuntimeException('Route publication unexpectedly changed the route verification field.');
    $unverifiedSegments=$pdo->prepare('SELECT COUNT(*) FROM campus_route_segments s JOIN map_connections e ON e.id=s.connection_id WHERE s.route_id=? AND e.verified=0');$unverifiedSegments->execute([$createdRouteId]);
    if((int)$unverifiedSegments->fetchColumn()!==0)throw new RuntimeException('A published route contains an unverified segment.');
    expect_status(request_api('routes','POST',['name'=>$prefix.' Duplicate Visual Route','start_marker_id'=>$markerStart['id'],'destination_marker_id'=>$markerEnd['id'],'status'=>'active','confirm_walkway'=>true,'accessibility_status'=>1,'waypoints'=>[['node_id'=>$waypointNode['id']]]],$csrf,$sessionA),409,'Reject duplicate route geometry');
    pass('Duplicate saved route geometry is rejected');
    $storedRoutes=expect_status(request_api('routes','GET',null,null,$sessionA),200,'Read saved routes');
    $storedRoute=array_values(array_filter($storedRoutes,fn($row)=>(int)$row['id']===$createdRouteId))[0]??null;
    if(!$storedRoute||count($storedRoute['points'])!==3)throw new RuntimeException('Saved route points were not returned in order.');
    pass('Routes publish without location, marker, or walkway verification and preserve ordered waypoints');
    $mapAfter=expect_status(request_api('map'),200,'Read saved map');
    $markerByLocation=[];foreach($mapAfter['markers'] as $marker)$markerByLocation[(int)$marker['location_id']]=$marker;
    $routeStartNode=(int)($markerByLocation[$buildingId]['route_node_id']??0);$routeEndNode=(int)($markerByLocation[$destinationId]['route_node_id']??0);
    if (!$routeStartNode||!$routeEndNode) throw new RuntimeException('Route publication did not create endpoint walkway points automatically.');
    $graph=[];foreach($mapAfter['connections'] as $edge){$a=(int)$edge['from_node_id'];$b=(int)$edge['to_node_id'];$graph[$a][$b]=true;$graph[$b][$a]=true;}
    $reachable=static function(int $from,int $to,array $graph):bool{$seen=[$from=>true];$queue=[$from];while($queue){$at=array_shift($queue);if($at===$to)return true;foreach(array_keys($graph[$at]??[]) as $next){if(!isset($seen[$next])){$seen[$next]=true;$queue[]=$next;}}}return false;};
    if($reachable($routeStartNode,(int)$isolatedNode['id'],$graph)||!$reachable($routeStartNode,$routeEndNode,$graph))throw new RuntimeException('Connected/disconnected route graph check failed.');
    if(!$reachable((int)$standaloneNodeA['id'],(int)$standaloneNodeB['id'],$graph))throw new RuntimeException('A verified standalone graph edge was omitted from the public map.');
    if(!array_filter($mapAfter['connections'],fn($edge)=>(int)$edge['verified']===1&&$edge['connection_type']==='walkway'&&((int)$edge['from_node_id']===(int)$standaloneNodeA['id']&&(int)$edge['to_node_id']===(int)$standaloneNodeB['id'])))throw new RuntimeException('Verified graph connection type was not returned to the public map.');
    pass('Stored map markers and verified connected/disconnected route graph');
    $availableRoutes=expect_status(request_api('routes/available'),200,'Read published routes');
    if(!array_filter($availableRoutes,fn($route)=>(int)$route['id']===$createdRouteId))throw new RuntimeException('Published route was hidden because verification flags were unset.');
    if(!array_filter($mapAfter['connections'],fn($edge)=>(int)$edge['accessibility_value']===1))throw new RuntimeException('Accessible route segments are not exposed to the public map API.');
    if(array_filter($mapAfter['connections'],fn($edge)=>(int)$edge['verified']!==1))throw new RuntimeException('An unverified connection was exposed by the public map API.');
    pass('Public map API exposes only verified connections and preserves accessibility data');

    $testRoom=expect_status(request_api('rooms','POST',['building_id'=>$buildingId,'name'=>$prefix.' Room','room_number'=>$suffix,'floor_number'=>1,'floor_label'=>'First Floor','capacity'=>20,'description'=>$longDetails,'function_description'=>'Student advising','department_name'=>'Student Services','department_head'=>'Campus Advisor','contact_info'=>'Main desk, second floor','contact_email'=>'room@example.test','contact_phone'=>'+63 44 456 7890','website_url'=>'https://example.test/room','service_hours'=>'Weekdays, 8 AM to 5 PM','days_open'=>'Monday through Friday','lunch_break'=>'12 PM to 1 PM','services'=>$longDetails,'nearby_landmarks'=>'Library entrance','accessibility_status'=>1,'accessibility_details'=>'Accessible entrance at the east corridor'], $csrf,$sessionA),201,'Create test room');
    $createdRoomId=(int)$testRoom['id'];
    expect_status(request_api('rooms','PUT',['id'=>$createdRoomId,'building_id'=>$buildingId,'name'=>$prefix.' Updated Room','room_number'=>$suffix,'floor_number'=>1,'floor_label'=>'First Floor','capacity'=>22,'description'=>$longDetails,'function_description'=>'Student advising','department_name'=>'Student Services','department_head'=>'Campus Advisor','contact_info'=>'Main desk, second floor','contact_email'=>'room@example.test','contact_phone'=>'+63 44 456 7890','website_url'=>'https://example.test/room','service_hours'=>'Weekdays, 8 AM to 5 PM','days_open'=>'Monday through Friday','lunch_break'=>'12 PM to 1 PM','services'=>$longDetails,'nearby_landmarks'=>'Library entrance','accessibility_status'=>1,'accessibility_details'=>'Accessible entrance at the east corridor'],$csrf,$sessionA),200,'Update test room');
    $otherDeviceDirectory=expect_status(request_api('directory','GET',null,null,$sessionB),200,'Second session directory');
    $sharedRoom=false;foreach($otherDeviceDirectory['rooms'] as $room)if((int)$room['id']===$createdRoomId&&$room['name']===$prefix.' Updated Room')$sharedRoom=true;
    $sharedRoomData=array_values(array_filter($otherDeviceDirectory['rooms'],fn($room)=>(int)$room['id']===$createdRoomId))[0]??null;
    if(!$sharedRoom||!$sharedRoomData||$sharedRoomData['contactEmail']!=='room@example.test'||$sharedRoomData['contactPhone']!=='+63 44 456 7890'||$sharedRoomData['description']!==$longDetails||$sharedRoomData['services']!==$longDetails||$sharedRoomData['accessibilityDetails']!=='Accessible entrance at the east corridor'||(int)$sharedRoomData['accessibilityStatus']!==1||!is_array($sharedRoomData['photos'])||array_key_exists('accessibilityFeatures',$sharedRoomData))throw new RuntimeException('Second session could not see the complete updated room profile without building-only features.');
    pass('Long room detail persistence and shared-backend visibility from a separate session');

    $announcement=expect_status(request_api('announcements','POST',['title'=>$prefix.' Announcement','details'=>'Integration test event','status'=>'published','pinned'=>true,'event_start'=>'2026-11-05 09:00:00','event_end'=>'2026-11-05 12:00:00'], $csrf,$sessionA),201,'Create announcement');
    $createdAnnouncementId=(int)$announcement['id'];
    expect_status(request_api('announcements','PUT',['id'=>$createdAnnouncementId,'title'=>$prefix.' Updated Announcement','details'=>$longDetails,'status'=>'published','pinned'=>false,'event_start'=>'2026-11-05 09:00:00','event_end'=>'2026-11-05 12:00:00'],$csrf,$sessionA),200,'Edit announcement');
    $publicRows=expect_status(request_api('announcements'),200,'Read published announcement');
    if(!array_filter($publicRows,fn($item)=>$item['title']===$prefix.' Updated Announcement'&&$item['details']===$longDetails&&$item['event_start']==='2026-11-05 09:00:00'&&$item['event_end']==='2026-11-05 12:00:00'))throw new RuntimeException('Complete published announcement update was not visible publicly.');
    pass('Long announcement create, edit, publish, and public read');

    $duplicate= request_api('rooms','POST',['building_id'=>$buildingId,'name'=>'Duplicate','room_number'=>$suffix,'floor_number'=>1],$csrf,$sessionA);
    expect_status($duplicate,409,'Duplicate room constraint');
    pass('Duplicate room identifier rejected');

    expect_status(request_api('auth/logout','POST',[],$csrf,$sessionA),200,'Logout');
    expect_status(request_api('admin/overview','GET',null,null,$sessionA),401,'Expired administrator session');
    pass('Logout invalidates server-side session');

    fwrite(STDOUT, "PASS: " . count($passes) . " integration checks\n");
    foreach($passes as $item)fwrite(STDOUT,"- {$item}\n");
} finally {
    $pdo->beginTransaction();
    try {
        if ($createdAnnouncementId) $pdo->prepare('DELETE FROM announcements WHERE id=?')->execute([$createdAnnouncementId]);
        if ($createdAdminAccountId) { $pdo->prepare("DELETE FROM audit_logs WHERE entity_type='admin_account' AND entity_id=?")->execute([$createdAdminAccountId]);$pdo->prepare('DELETE FROM admin_users WHERE id=?')->execute([$createdAdminAccountId]); }
        if ($createdRouteId) { $q=$pdo->prepare('SELECT node_id FROM campus_route_points WHERE route_id=?');$q->execute([$createdRouteId]);$createdNodeIds=array_values(array_unique([...$createdNodeIds,...array_map('intval',$q->fetchAll(PDO::FETCH_COLUMN))]));$pdo->prepare('DELETE FROM campus_routes WHERE id=?')->execute([$createdRouteId]); }
        if ($createdMarkerIds) { $in=implode(',',array_fill(0,count($createdMarkerIds),'?'));$pdo->prepare("DELETE FROM campus_routes WHERE landmark_marker_id IN ({$in})")->execute($createdMarkerIds);$pdo->prepare("DELETE FROM map_markers WHERE id IN ({$in})")->execute($createdMarkerIds); }
        if ($createdNodeIds) { $in=implode(',',array_fill(0,count($createdNodeIds),'?'));$pdo->prepare("DELETE FROM map_connections WHERE from_node_id IN ({$in}) OR to_node_id IN ({$in})")->execute([...$createdNodeIds,...$createdNodeIds]);$pdo->prepare("DELETE FROM map_nodes WHERE id IN ({$in})")->execute($createdNodeIds); }
        if ($createdRoomId) $pdo->prepare('DELETE FROM rooms WHERE id=?')->execute([$createdRoomId]);
        if ($createdLocationIds) { $in=implode(',',array_fill(0,count($createdLocationIds),'?'));$pdo->prepare("DELETE FROM locations WHERE id IN ({$in})")->execute($createdLocationIds); }
        if ($adminId) { $pdo->prepare('DELETE FROM audit_logs WHERE admin_id=?')->execute([$adminId]);$pdo->prepare('DELETE FROM admin_users WHERE id=?')->execute([$adminId]); }
        $pdo->commit();
    } catch(Throwable $cleanupError) { if($pdo->inTransaction())$pdo->rollBack();fwrite(STDERR,"Cleanup warning: {$cleanupError->getMessage()}\n"); }
    @unlink($sessionA);@unlink($sessionB);
}
