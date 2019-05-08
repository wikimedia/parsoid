<?php
declare( strict_types = 1 );

namespace Parsoid\Html2Wt\DOMHandlers;

use DOMElement;
use DOMNode;
use Parsoid\Html2Wt\SerializerState;
use Parsoid\Html2Wt\WTSUtils;
use Parsoid\Utils\DOMDataUtils;
use Parsoid\Utils\PHPUtils;

class CaptionHandler extends DOMHandler {

	public function __construct() {
		parent::__construct( false );
	}

	/** @inheritDoc */
	public function handle(
		DOMElement $node, SerializerState $state, bool $wrapperUnmodified = false
	): ?DOMElement {
		$dp = DOMDataUtils::getDataParsoid( $node );
		// Serialize the tag itself
		$tableTag = $this->serializeTableTag(
			PHPUtils::coalesce( $dp->startTagSrc ?? null, '|+' ), null, $state, $node,
			$wrapperUnmodified
		);
		WTSUtils::emitStartTag( $tableTag, $node, $state );
		$state->serializeChildren( $node );
		return null;
	}

	/** @inheritDoc */
	public function before( DOMElement $node, DOMNode $otherNode, SerializerState $state ): array {
		return ( $otherNode->nodeName !== 'table' )
			? [ 'min' => 1, 'max' => $this->maxNLsInTable( $node, $otherNode ) ]
			: [ 'min' => 0, 'max' => $this->maxNLsInTable( $node, $otherNode ) ];
	}

	/** @inheritDoc */
	public function after( DOMElement $node, DOMNode $otherNode, SerializerState $state ): array {
		return [ 'min' => 1, 'max' => $this->maxNLsInTable( $node, $otherNode ) ];
	}

}